import { expect, it } from 'vitest';
import { terminalColorOptions, terminalTheme } from './terminalTheme';
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
it('matches integrated terminal contrast defaults while honoring color settings', () => {
  expect(terminalColorOptions(() => undefined)).toEqual({ minimumContrastRatio: 4.5, drawBoldTextInBrightColors: true });
  expect(terminalColorOptions(name => name === 'minimumContrastRatio' ? 1 : false)).toEqual({ minimumContrastRatio: 1, drawBoldTextInBrightColors: false });
  expect(terminalColorOptions(name => name === 'minimumContrastRatio' ? 7 : false).minimumContrastRatio).toBe(7);
});
it('keeps invalid contrast values within the renderer limits', () => {
  expect(terminalColorOptions(() => NaN).minimumContrastRatio).toBe(4.5);
  expect(terminalColorOptions(() => 0).minimumContrastRatio).toBe(1);
  expect(terminalColorOptions(() => 50).minimumContrastRatio).toBe(21);
});
it('uses the full selection color without fading it in unfocused terminals', () => {
  for (const [source, expected] of [['#f2388860', '#f23888'], ['#f286', '#f28'], ['rgba(242, 56, 136, 0.376)', 'rgb(242, 56, 136)']]) {
    const values: Record<string, string> = { '--vscode-terminal-selectionBackground': source, '--vscode-terminal-selectionForeground': '#0b0d11', '--vscode-terminal-inactiveSelectionBackground': '#f2388830' };
    const theme = terminalTheme(key => values[key] ?? '');
    expect(theme.selectionBackground).toBe(expected);
    expect(theme.selectionInactiveBackground).toBe(expected);
    expect(theme.selectionForeground).toBe('#0b0d11');
  }
});
it('preserves VS Code selection styling when explicitly selected', () => {
  const values: Record<string, string> = { '--vscode-terminal-selectionBackground': '#f2388860', '--vscode-terminal-inactiveSelectionBackground': '#f2388830', '--vscode-terminal-background': '#0b0d11' };
  const theme = terminalTheme(key => values[key] ?? '', 'theme');
  expect(theme.selectionBackground).toBe('#f2388860');
  expect(theme.selectionInactiveBackground).toBe('#f2388830');
  expect(theme.selectionForeground).toBeUndefined();
  expect(terminalTheme(key => values[key] ?? '').selectionForeground).toBe('#0b0d11');
});
