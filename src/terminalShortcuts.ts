// CSI-u preserves Shift+Enter as a distinct key for terminal applications.
// Sending CR/LF instead would lose the modifier and can submit an unfinished prompt.
export const SHIFT_ENTER_SEQUENCE = '\x1b[13;2u';
export const ESCAPE_SEQUENCE = '\x1b';

export function terminalShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'> & { isComposing?: boolean }, mac: boolean): 'interrupt' | 'copy' | 'paste' | 'shiftEnter' | 'escape' | null {
  if (event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'escape' && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.isComposing) return 'escape';
  if (key === 'enter' && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.isComposing) return 'shiftEnter';
  if (event.ctrlKey && !event.metaKey && !event.shiftKey && key === 'c') return 'interrupt';
  const clipboard = mac ? event.metaKey && !event.ctrlKey && !event.shiftKey : event.ctrlKey && event.shiftKey && !event.metaKey;
  if (clipboard && key === 'c') return 'copy';
  if (clipboard && key === 'v') return 'paste';
  return null;
}
