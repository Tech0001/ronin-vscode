import { expect, it } from 'vitest';
import { ESCAPE_SEQUENCE, SHIFT_ENTER_SEQUENCE, terminalShortcut } from './terminalShortcuts';
import { readFileSync } from 'node:fs';
const event = (key: string, ctrlKey = false, shiftKey = false, metaKey = false) => ({ key, ctrlKey, shiftKey, metaKey, altKey: false });
it('uses Linux terminal interrupt/copy/paste shortcuts', () => {
  expect(terminalShortcut(event('c', true), false)).toBe('interrupt');
  expect(terminalShortcut(event('C', true, true), false)).toBe('copy');
  expect(terminalShortcut(event('V', true, true), false)).toBe('paste');
  expect(terminalShortcut(event('v', true), false)).toBeNull();
});
it('uses Command for macOS clipboard, Control for interrupt', () => {
  expect(terminalShortcut(event('c', false, false, true), true)).toBe('copy');
  expect(terminalShortcut(event('v', false, false, true), true)).toBe('paste');
  expect(terminalShortcut(event('c', true), true)).toBe('interrupt');
});

it.each([false, true])('preserves Shift+Enter independently of the clipboard platform (mac=%s)', mac => {
  expect(terminalShortcut(event('Enter', false, true), mac)).toBe('shiftEnter');
  expect(SHIFT_ENTER_SEQUENCE).toBe('\x1b[13;2u');
  expect(SHIFT_ENTER_SEQUENCE).not.toMatch(/[\r\n]/);
});

it('leaves plain Enter, other modifiers, and IME confirmation to xterm', () => {
  expect(terminalShortcut(event('Enter'), false)).toBeNull();
  expect(terminalShortcut(event('Enter', true, true), false)).toBeNull();
  expect(terminalShortcut(event('Enter', false, true, true), true)).toBeNull();
  expect(terminalShortcut({ ...event('Enter', false, true), altKey: true }, false)).toBeNull();
  expect(terminalShortcut({ ...event('Enter', false, true), isComposing: true }, false)).toBeNull();
});

it.each([false, true])('forwards plain Escape as Escape, never Ctrl+C (mac=%s)', mac => {
  expect(terminalShortcut(event('Escape'), mac)).toBe('escape');
  expect(ESCAPE_SEQUENCE).toBe('\x1b');
  expect(ESCAPE_SEQUENCE).not.toBe('\x03');
  expect(terminalShortcut(event('Escape', true), mac)).toBeNull();
  expect(terminalShortcut(event('Escape', false, true), mac)).toBeNull();
  expect(terminalShortcut(event('Escape', false, false, true), mac)).toBeNull();
  expect(terminalShortcut({ ...event('Escape'), altKey: true }, mac)).toBeNull();
  expect(terminalShortcut({ ...event('Escape'), isComposing: true }, mac)).toBeNull();
});

it('registers Escape only for a focused Ronin terminal at the VS Code dispatch layer', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(manifest.contributes.keybindings.filter((binding: {key: string}) => binding.key === 'escape')).toEqual([{
    command: 'ronin.escape', key: 'escape',
    when: "activeWebviewPanelId == 'ronin.canvas' && webviewFocus && ronin.terminalFocused",
  }]);
});
