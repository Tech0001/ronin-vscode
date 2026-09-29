import { expect, it } from 'vitest';
import { Terminal } from '@xterm/headless';
import { SerializeAddon } from '@xterm/addon-serialize';
import { preserveMouseEncoding } from './mouseEncoding';

const write = (screen: Terminal, data: string) => new Promise<void>(resolve => screen.write(data, resolve));
async function modes(screen: Terminal) {
  let reply = '';
  const listener = screen.onData(data => { reply += data; });
  await write(screen, '\x1b[?1006$p\x1b[?1016$p');
  listener.dispose();
  return reply;
}

it.each([
  ['SGR', '\x1b[?1006h'],
  ['pixel SGR', '\x1b[?1016h'],
  ['legacy', ''],
  ['disabled SGR', '\x1b[?1006h\x1b[?1006l'],
  ['encoding switch', '\x1b[?1006;1016h'],
  ['reset either encoding', '\x1b[?1016h\x1b[?1006l'],
  ['full reset', '\x1b[?1006h\x1bc'],
])('preserves %s mouse reports across terminal restore', async (_, controls) => {
  const source = new Terminal({ allowProposedApi: true });
  const restored = new Terminal({ allowProposedApi: true });
  try {
    const encoding = preserveMouseEncoding(source);
    const serializer = new SerializeAddon(); source.loadAddon(serializer);
    // Feed one character at a time: the mode may cross any PTY output boundary.
    for (const char of '\x1b[?1049h\x1b[?1003h' + controls) await write(source, char);
    await write(restored, serializer.serialize() + encoding());
    expect(await modes(restored)).toBe(await modes(source));
    expect(restored.modes.mouseTrackingMode).toBe(source.modes.mouseTrackingMode);
    expect(restored.buffer.active.type).toBe(source.buffer.active.type);
  } finally { source.dispose(); restored.dispose(); }
});

it('does not treat apparent mode changes inside OSC text as controls', async () => {
  const screen = new Terminal({ allowProposedApi: true });
  try {
    const encoding = preserveMouseEncoding(screen);
    await write(screen, '\x1b[?1006h\x1b]0;title [ ? 1016 h\x07');
    expect(encoding()).toBe('\x1b[?1006l\x1b[?1016l\x1b[?1006h');
  } finally { screen.dispose(); }
});
