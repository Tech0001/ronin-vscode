import { expect, it, vi } from 'vitest';
import { terminalCopyAction } from './terminalCopy';

it('copies a native selection without consulting the foreground process', async () => {
  const detect = vi.fn(async () => 'Pi');
  expect(await terminalCopyAction('selected text', 123, detect)).toBe('clipboard');
  expect(detect).not.toHaveBeenCalled();
});

it('uses Pi copy for an app-owned selection even when the service has no agent label', async () => {
  const detect = vi.fn(async () => 'Pi');
  expect(await terminalCopyAction('', 123, detect)).toBe('pi');
  expect(detect).toHaveBeenCalledWith(123);
});

it('preserves the clipboard when no Pi selection can be copied', async () => {
  expect(await terminalCopyAction('', 123, async () => 'Claude')).toBe('none');
  expect(await terminalCopyAction('', undefined, async () => 'Pi')).toBe('none');
});
