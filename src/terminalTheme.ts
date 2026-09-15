import type { ITheme } from '@xterm/xterm';
import type { TerminalColorOptions, TerminalSelectionStyle } from './shared';

/** Match the integrated terminal's color rendering, including selected text. */
export function terminalColorOptions(read: (name: string) => unknown): TerminalColorOptions {
  const contrast = read('minimumContrastRatio');
  const brightBold = read('drawBoldTextInBrightColors');
  return {
    minimumContrastRatio: typeof contrast === 'number' && Number.isFinite(contrast) ? Math.min(21, Math.max(1, contrast)) : 4.5,
    drawBoldTextInBrightColors: typeof brightBold === 'boolean' ? brightBold : true,
  };
}

export const defaultTerminalColorOptions = terminalColorOptions(() => undefined);

// VS Code serializes theme colors as hex or rgba(). Keep the hue while removing
// the editor selection's transparency for a solid terminal-style highlight.
function opaqueSelectionColor(value: string | undefined): string | undefined {
  return value
    ?.replace(/^(#[\da-f]{6})[\da-f]{2}$/i, '$1')
    .replace(/^(#[\da-f]{3})[\da-f]$/i, '$1')
    .replace(/^rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)$/i, 'rgb($1,$2,$3)');
}

/** Resolve VS Code's live webview palette, including all 16 terminal ANSI colors. */
export function terminalTheme(read: (name: string) => string, selectionStyle: TerminalSelectionStyle = 'solid'): ITheme {
  const color = (...names: string[]) => names.map(name => read(`--vscode-${name}`).trim()).find(Boolean);
  const theme: ITheme = {
    background: color('terminal-background', 'editor-background'),
    foreground: color('terminal-foreground', 'editor-foreground', 'foreground'),
    cursor: color('terminalCursor-foreground', 'terminal-foreground', 'editor-foreground'),
    cursorAccent: color('terminalCursor-background', 'terminal-background', 'editor-background'),
    selectionBackground: color('terminal-selectionBackground', 'editor-selectionBackground'),
    selectionInactiveBackground: color('terminal-inactiveSelectionBackground', 'editor-inactiveSelectionBackground', 'terminal-selectionBackground'),
    selectionForeground: color('terminal-selectionForeground'),
  };
  if (selectionStyle === 'solid') {
    theme.selectionBackground = opaqueSelectionColor(theme.selectionBackground);
    // Keep selections legible while working in another pane or reviewing a file.
    theme.selectionInactiveBackground = theme.selectionBackground;
    theme.selectionForeground ??= theme.background;
  }
  for (const name of ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'] as const) {
    theme[name] = color(`terminal-ansi${name[0].toUpperCase()}${name.slice(1)}`);
  }
  return theme;
}

export function currentTerminalTheme(selectionStyle: TerminalSelectionStyle = 'solid'): ITheme {
  const style = getComputedStyle(document.body);
  return terminalTheme(name => style.getPropertyValue(name), selectionStyle);
}
