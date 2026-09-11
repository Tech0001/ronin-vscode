import { describe, expect, it } from "vitest";
import { arrangeTerminalPanels, dropTerminalPanel, type TerminalPanel } from "./terminalLayout";

const row: TerminalPanel[] = [0, 1, 2].map((index) => ({ processId: index + 1, x: 12 + index * 408, y: 12, width: 400, height: 300 }));
describe("canvas drop reordering", () => {
  it("slides a small leftward overlap back right without moving neighbors", () => {
    const result = dropTerminalPanel(row, { ...row[1], x: row[1].x - 20 });
    expect(result).toEqual(row);
  });
  it("tolerates edge gaps and quarter-width overlap without reordering", () => {
    for (const shift of [1, 8, 100]) {
      expect(dropTerminalPanel(row, { ...row[1], x: row[1].x - shift })).toEqual(row);
    }
  });
  it("nudges shallow vertical and corner overlap clear without shifting neighbors", () => {
    const before = [row[0], { ...row[1], x: 12, y: 500 }];
    const result = dropTerminalPanel(before, { ...before[1], x: 30, y: 300 });
    expect(result[0]).toEqual(before[0]);
    expect(result[1]).toEqual({ ...before[1], x: 30, y: 320 });
    const corner = dropTerminalPanel(before, { ...before[1], x: 400, y: 300 });
    expect(corner[0]).toEqual(before[0]);
    expect(corner.map((p) => p.processId)).toEqual([1, 2]);
  });
  it("inserts over a neighbor and shifts intervening panes into the vacated slot", () => {
    const result = dropTerminalPanel(row, { ...row[0], x: row[2].x });
    expect(result.map((panel) => panel.processId)).toEqual([2, 3, 1]);
    expect(result.map((panel) => panel.x)).toEqual(row.map((panel) => panel.x));
    expect(row[0].x).toBe(12);
  });
  it("supports reverse and cross-row moves", () => {
    const grid = [...row, { ...row[0], processId: 4, y: 320 }];
    expect(dropTerminalPanel(grid, { ...grid[3], x: row[0].x, y: row[0].y }).map((panel) => panel.processId)).toEqual([4, 1, 2, 3]);
  });
  it("allows free placement in empty canvas space", () => {
    const dropped = { ...row[0], x: 60, y: 500 };
    expect(dropTerminalPanel(row, dropped)).toEqual([dropped, row[1], row[2]]);
  });
  it("keeps differently sized panes separate and anchors the dropped pane", () => {
    const sized = [{ ...row[0], width: 600 }, { ...row[1], x: 620 }, { ...row[2], x: 1028 }];
    const result = dropTerminalPanel(sized, { ...sized[0], x: 620 });
    expect(result.find((panel) => panel.processId === 1)?.x).toBe(620);
    for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length; j++) {
      const a = result[i], b = result[j];
      expect(a.x + a.width + 8 <= b.x || b.x + b.width + 8 <= a.x || a.y + a.height + 8 <= b.y || b.y + b.height + 8 <= a.y).toBe(true);
    }
  });
});

describe("arrange terminals", () => {
  const sized = [{ ...row[0], width: 600, height: 450 }, row[1], { ...row[2], width: 500 }];
  it("preserves every custom size and packs using the tallest pane in each row", () => {
    const result = arrangeTerminalPanels(sized, 1200, 2);
    expect(result.map(({ width, height }) => ({ width, height }))).toEqual(sized.map(({ width, height }) => ({ width, height })));
    expect(result.map(({ x, y }) => ({ x, y }))).toEqual([{ x: 12, y: 12 }, { x: 620, y: 12 }, { x: 12, y: 470 }]);
    expect(sized[1].x).toBe(420);
  });
  it("wraps at the viewport width in automatic mode without shrinking large panes", () => {
    const result = arrangeTerminalPanels(sized, 900);
    expect(result.map((p) => p.y)).toEqual([12, 470, 778]);
    expect(arrangeTerminalPanels(sized, 300)[0].width).toBe(600);
  });
});
