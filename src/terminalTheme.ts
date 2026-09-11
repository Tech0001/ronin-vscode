import type { ITheme } from '@xterm/xterm';

/** Resolve VS Code's live webview palette, including all 16 terminal ANSI colors. */
export function terminalTheme(read: (name: string) => string): ITheme {
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
  for (const name of ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'] as const) {
    theme[name] = color(`terminal-ansi${name[0].toUpperCase()}${name.slice(1)}`);
  }
  return theme;
}

export function currentTerminalTheme(): ITheme {
  const style = getComputedStyle(document.body);
  return terminalTheme(name => style.getPropertyValue(name));
}
