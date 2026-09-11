import { expect, it } from 'vitest';
import { SHIFT_ENTER_SEQUENCE, terminalShortcut } from './terminalShortcuts';
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
