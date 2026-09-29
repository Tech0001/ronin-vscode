import type { Terminal } from '@xterm/headless';

// SerializeAddon preserves mouse tracking (1000/1002/1003), but omits its
// encoding (1006/1016). Restoring tracking alone silently changes wheel input
// from SGR to legacy bytes, which full-screen applications may not understand.
// Observe parsed controls so split writes, OSC contents and resets are handled
// by xterm itself; do not scan raw output with a regular expression.
export function preserveMouseEncoding(screen: Terminal): () => string {
  let encoding = 0;
  for (const final of ['h', 'l']) {
    screen.parser.registerCsiHandler({ prefix: '?', final }, params => {
      for (const mode of params) {
        if (mode === 1006 || mode === 1016) encoding = final === 'h' ? mode : 0;
      }
      return false;
    });
  }
  screen.parser.registerEscHandler({ final: 'c' }, () => { encoding = 0; return false; });
  return () => '\x1b[?1006l\x1b[?1016l' + (encoding ? `\x1b[?${encoding}h` : '');
}
