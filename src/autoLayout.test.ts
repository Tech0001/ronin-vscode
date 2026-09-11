import { it, expect } from 'vitest';
import { autoFitPanels } from './autoLayout';
const panes = Array.from({ length: 7 }, (_, i) => ({ processId: i, x: 12, y: 12, width: 500, height: 380 }));
it('fills the height with one row and shares height when another row is added', () => {
  expect(autoFitPanels(panes.slice(0,6), 3600, 1000, 6)[0].height).toBe(976);
  const twoRows = autoFitPanels(panes,3600,1000,6);
  expect(twoRows[0].height).toBe(484);
  expect(twoRows[6].y).toBe(504);
  expect(autoFitPanels(twoRows.slice(0,6),3600,1000,6)[0].height).toBe(976);
});
it('keeps a minimum usable size and leaves input objects intact', () => {
  const result = autoFitPanels(panes, 600, 400, 2);
  expect(result[0].height).toBe(220);
  expect(result[0].width).toBe(300);
  expect(panes[0].height).toBe(380);
});
