import { describe, expect, it } from 'vitest';
import headless from '@xterm/headless';
import { terminalLinkMode, terminalLinks } from './terminalLinks';

async function screen(text: string, cols = 24) {
  const term = new headless.Terminal({ cols, rows: 24, allowProposedApi: true });
  await new Promise<void>(resolve => term.write(text, resolve));
  return term;
}

describe('terminal links', () => {
  it('returns the complete path from every soft-wrapped row, including line and column', async () => {
    const target = '/home/pc/Documents/GitHub/agent-Nova/docs/audit/2026-09-11-fiber-review.md:42:3';
    const term = await screen('Report: ' + target);
    try {
      for (let row = 1; row <= 4; row++) {
        expect(terminalLinks(term.buffer.active, term.cols, row)).toEqual([{ text: target, range: { start: { x: 9, y: 1 }, end: { x: (8 + target.length - 1) % 24 + 1, y: 4 } } }]);
      }
    } finally { term.dispose(); }
  });
  it('keeps hard newlines separate and removes prose delimiters', async () => {
    const term = await screen('(/tmp/a.md:8),\r\n/tmp/b.md');
    try {
      expect(terminalLinks(term.buffer.active, term.cols, 1).map(l => l.text)).toEqual(['/tmp/a.md:8']);
      expect(terminalLinks(term.buffer.active, term.cols, 2).map(l => l.text)).toEqual(['/tmp/b.md']);
    } finally { term.dispose(); }
  });
  it('maps wide and combined characters to cells and includes Unicode paths', async () => {
    const term = await screen('界 e\u0301 /tmp/文件.md:9', 12);
    try {
      const [link] = terminalLinks(term.buffer.active, term.cols, 2);
      expect(link.text).toBe('/tmp/文件.md:9');
      expect(link.range).toEqual({ start: { x: 6, y: 1 }, end: { x: 7, y: 2 } });
    } finally { term.dispose(); }
  });
  it('detects wrapped quoted paths, file URIs, home paths, and complete URLs', async () => {
    for (const [text, target] of [
      ['"/tmp/my project/long file.md:12"', '/tmp/my project/long file.md:12'],
      ['file:///tmp/my%20project/long%20file.md#L20C2', 'file:///tmp/my%20project/long%20file.md#L20C2'],
      ['~/Documents/notes.md:4', '~/Documents/notes.md:4'],
      ['(https://example.com/a/b?q=hello).', 'https://example.com/a/b?q=hello'],
    ]) {
      const term = await screen(text, 16);
      try { expect(terminalLinks(term.buffer.active, term.cols, 2)[0].text).toBe(target); }
      finally { term.dispose(); }
    }
  });
  it('requires Ctrl and only opens on a left click', () => {
    const click = { button: 0, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
    expect(terminalLinkMode(click)).toBeUndefined();
    expect(terminalLinkMode({ ...click, shiftKey: true })).toBeUndefined();
    expect(terminalLinkMode({ ...click, ctrlKey: true })).toBe('preview');
    expect(terminalLinkMode({ ...click, ctrlKey: true, shiftKey: true })).toBe('background');
    expect(terminalLinkMode({ ...click, ctrlKey: true, button: 1 })).toBeUndefined();
    expect(terminalLinkMode({ ...click, ctrlKey: true, altKey: true })).toBeUndefined();
  });
});
