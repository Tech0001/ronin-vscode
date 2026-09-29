import type { IBuffer, IBufferCellPosition, ILink } from '@xterm/xterm';

export function terminalLinkMode(event: Pick<MouseEvent, 'button' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>): 'preview' | 'background' | undefined {
  if (event.button !== 0 || !event.ctrlKey || event.altKey || event.metaKey) return;
  return event.shiftKey ? 'background' : 'preview';
}

type TerminalLink = Pick<ILink, 'text' | 'range'>;

// Map UTF-16 offsets back to cells so wide/combined characters do not shift links.
function readRows(buffer: IBuffer, cols: number, first: number, last: number, hardBreaks = false) {
  let text = '';
  const starts: IBufferCellPosition[] = [], ends: IBufferCellPosition[] = [];
  for (let y = first; y <= last; y++) {
    const line = buffer.getLine(y)!;
    const wraps = buffer.getLine(y + 1)?.isWrapped;
    let length = Math.min(cols, line.length);
    if (hardBreaks && !wraps) {
      while (length && !line.getCell(length - 1)?.getChars().trim()) length--;
    }
    for (let x = 0; x < length; x++) {
      const cell = line.getCell(x)!;
      const width = cell.getWidth();
      if (!width) continue;
      // xterm leaves a null cell when a wide glyph wraps before the right edge.
      if (x === cols - 1 && !cell.getChars() && wraps && y < last && buffer.getLine(y + 1)?.getCell(0)?.getWidth() === 2) continue;
      const chars = cell.getChars() || ' ';
      text += chars;
      for (let i = 0; i < chars.length; i++) {
        starts.push({ x: x + 1, y: y + 1 });
        ends.push({ x: Math.min(cols, x + width), y: y + 1 });
      }
    }
    if (hardBreaks && !wraps && y < last) {
      text += '\n';
      starts.push({ x: cols, y: y + 1 }); ends.push({ x: cols, y: y + 1 });
    }
  }
  return { text, starts, ends };
}

const looksLikePath = (text: string) => /^(?:https?:\/\/|file:\/\/|~?\/|\.{1,2}\/)|^[^\s]+\/|\.[\w]+(?::\d+(?::\d+)?)?$/.test(text);
const cellOffset = (cell: IBufferCellPosition, cols: number) => (cell.y - 1) * cols + cell.x - 1;

// TUIs also wrap paths themselves with CRLF and indentation. Join only paths
// enclosed in quotes/backticks/parentheses; unrelated output rows stay separate.
function hardWrappedLinks(buffer: IBuffer, cols: number, row: number): TerminalLink[] {
  const { text, starts, ends } = readRows(buffer, cols, Math.max(0, row - 13), Math.min(buffer.length - 1, row + 11), true);
  const links: TerminalLink[] = [];
  const enclosed = /(["'`])([^"'`]*?\n[^"'`]*?)\1|\(([^()]*?\n[^()]*?)\)/gu;
  for (const match of text.matchAll(enclosed)) {
    const content = match[2] ?? match[3];
    // Blank lines are paragraph boundaries, not path continuations.
    if (/\n[ \t]*\n/.test(content)) continue;
    const target = content.replace(/\n[ \t]*/g, '');
    if (!looksLikePath(target) || (!match[1] && /\s/.test(target))) continue;
    const start = match.index! + 1;
    const range = { start: starts[start], end: ends[start + content.length - 1] };
    if (range.start.y <= row && range.end.y >= row) links.push({ text: target, range });
  }
  return links;
}

// A terminal row is a display detail: a path can cross several soft wraps.
export function terminalLinks(buffer: IBuffer, cols: number, row: number): TerminalLink[] {
  let first = row - 1, last = row - 1;
  if (!buffer.getLine(first)) return [];
  while (first > 0 && buffer.getLine(first)?.isWrapped) first--;
  while (buffer.getLine(last + 1)?.isWrapped) last++;
  const { text, starts, ends } = readRows(buffer, cols, first, last);
  const pattern = /(["'`])([^\r\n]*?)\1|(?:https?|file):\/\/[^\s<>"'`]+|(?:~?\/[\p{L}\p{N}\p{M}_.@+-]+(?:\/[\p{L}\p{N}\p{M}_.@+-]+)*|(?:\.{1,2}\/)?(?:[\p{L}\p{N}\p{M}_.@+-]+\/)*[\p{L}\p{N}\p{M}_.@+-]+\.\w{1,12})(?::\d+(?::\d+)?|#L\d+(?:C\d+)?)?/gu;
  const links = hardWrappedLinks(buffer, cols, row);
  for (const match of text.matchAll(pattern)) {
    const quoted = Boolean(match[1]);
    let target = quoted ? match[2] : match[0];
    if (quoted && !looksLikePath(target)) continue;
    if (!quoted) {
      target = target.replace(/[.,;!?]+$/, '');
      // A Markdown/prose closing bracket is not part of the URL unless balanced.
      for (const [open, close] of [['(', ')'], ['[', ']']]) {
        while (target.endsWith(close) && target.split(close).length > target.split(open).length) target = target.slice(0, -1);
      }
    }
    if (!target) continue;
    const start = match.index! + (quoted ? 1 : 0);
    const range = { start: starts[start], end: ends[start + target.length - 1] };
    if (links.some(link => cellOffset(range.start, cols) <= cellOffset(link.range.end, cols) && cellOffset(range.end, cols) >= cellOffset(link.range.start, cols))) continue;
    if (range.start.y <= row && range.end.y >= row) links.push({ text: target, range });
  }
  return links.sort((a, b) => cellOffset(a.range.start, cols) - cellOffset(b.range.start, cols));
}
