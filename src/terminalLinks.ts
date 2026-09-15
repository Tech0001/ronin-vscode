import type { IBuffer, IBufferCellPosition, ILink } from '@xterm/xterm';

export function terminalLinkMode(event: Pick<MouseEvent, 'button' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>): 'preview' | 'background' | undefined {
  if (event.button !== 0 || !event.ctrlKey || event.altKey || event.metaKey) return;
  return event.shiftKey ? 'background' : 'preview';
}

// A terminal row is a display detail: a path can cross several soft wraps.
// Map UTF-16 offsets back to cells so wide/combined characters do not shift links.
export function terminalLinks(buffer: IBuffer, cols: number, row: number): Pick<ILink, 'text' | 'range'>[] {
  let first = row - 1, last = row - 1;
  if (!buffer.getLine(first)) return [];
  while (first > 0 && buffer.getLine(first)?.isWrapped) first--;
  while (buffer.getLine(last + 1)?.isWrapped) last++;
  let text = '';
  const starts: IBufferCellPosition[] = [], ends: IBufferCellPosition[] = [];
  for (let y = first; y <= last; y++) {
    const line = buffer.getLine(y)!;
    for (let x = 0; x < Math.min(cols, line.length); x++) {
      const cell = line.getCell(x)!;
      const width = cell.getWidth();
      if (!width) continue;
      // xterm leaves a null cell when a wide glyph wraps before the right edge.
      if (x === cols - 1 && !cell.getChars() && y < last && buffer.getLine(y + 1)?.getCell(0)?.getWidth() === 2) continue;
      const chars = cell.getChars() || ' ';
      text += chars;
      for (let i = 0; i < chars.length; i++) {
        starts.push({ x: x + 1, y: y + 1 });
        ends.push({ x: Math.min(cols, x + width), y: y + 1 });
      }
    }
  }
  const pattern = /(["'`])([^\r\n]*?)\1|(?:https?|file):\/\/[^\s<>"'`]+|(?:~?\/[\p{L}\p{N}\p{M}_.@+-]+(?:\/[\p{L}\p{N}\p{M}_.@+-]+)*|(?:\.{1,2}\/)?(?:[\p{L}\p{N}\p{M}_.@+-]+\/)*[\p{L}\p{N}\p{M}_.@+-]+\.\w{1,12})(?::\d+(?::\d+)?|#L\d+(?:C\d+)?)?/gu;
  const links: Pick<ILink, 'text' | 'range'>[] = [];
  for (const match of text.matchAll(pattern)) {
    const quoted = Boolean(match[1]);
    let target = quoted ? match[2] : match[0];
    if (quoted && !/^(?:https?:\/\/|file:\/\/|~?\/|\.{1,2}\/)|^[^\s]+\/|\.[\w]+(?::\d+(?::\d+)?)?$/.test(target)) continue;
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
    if (range.start.y <= row && range.end.y >= row) links.push({ text: target, range });
  }
  return links;
}
