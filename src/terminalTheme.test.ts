import { expect, it } from 'vitest';
import { terminalTheme } from './terminalTheme';
it('uses terminal colors before editor fallbacks and maps the ANSI palette', () => {
  const values: Record<string, string> = { '--vscode-terminal-background': '#123456', '--vscode-editor-background': '#ffffff', '--vscode-terminal-foreground': '#abcdef', '--vscode-terminal-ansiBrightRed': '#ff1234' };
  const theme = terminalTheme(key => values[key] ?? '');
  expect(theme.background).toBe('#123456');
  expect(theme.foreground).toBe('#abcdef');
  expect(theme.cursor).toBe('#abcdef');
  expect(theme.brightRed).toBe('#ff1234');
});
it('falls back to editor colors and does not retain colors from the previous theme', () => {
  const light = terminalTheme(key => ({ '--vscode-editor-background': '#ffffff', '--vscode-editor-foreground': '#111111' }[key] ?? ''));
  expect(light.background).toBe('#ffffff');
  expect(light.foreground).toBe('#111111');
  expect(light.brightRed).toBeUndefined();
});
