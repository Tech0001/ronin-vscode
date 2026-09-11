import type { TerminalPanel } from './terminalLayout';
export function autoFitPanels<T extends TerminalPanel>(panels: T[], width: number, height: number, columns = 0): T[] {
  if (!panels.length) return panels;
  const count = Math.min(panels.length, columns || Math.max(1, Math.floor((width - 24 + 8) / 568)));
  const rows = Math.ceil(panels.length / count);
  const paneWidth = Math.max(300, Math.floor((width - 24 - (count - 1) * 8) / count));
  const paneHeight = Math.max(220, Math.floor((height - 24 - (rows - 1) * 8) / rows));
  return panels.map((panel, index) => ({ ...panel, x: 12 + index % count * (paneWidth + 8), y: 12 + Math.floor(index / count) * (paneHeight + 8), width: paneWidth, height: paneHeight }));
}
