// Test twelve panes against live theme changes, including invisible panel tokens.
const { chromium } = await import(process.env.RONIN_PLAYWRIGHT ?? 'playwright');
import assert from 'node:assert/strict';
import path from 'node:path';

const dist = process.env.RONIN_WEBVIEW_DIST ?? path.resolve(import.meta.dirname, '../dist');
const browser = await chromium.launch({ headless: true, executablePath: process.env.RONIN_CHROMIUM ?? '/usr/bin/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.setContent('<div id="root"></div>');
  await page.evaluate(() => {
    window.acquireVsCodeApi = () => ({ postMessage: () => {}, setState: () => {} });
  });
  await page.addStyleTag({ path: path.join(dist, 'webview.css') });
  await page.addScriptTag({ path: path.join(dist, 'webview.js') });
  const themes = [
    { name: 'dark', background: '#14171c', foreground: '#d4d4d4', focus: '#81a1c1' },
    { name: 'light', background: '#ffffff', foreground: '#333333', focus: '#005fb8' },
    { name: 'green', background: '#141a10', foreground: '#88c070', focus: '#a3d977' },
    { name: 'high contrast', background: '#000000', foreground: '#ffffff', focus: '#ffff00', contrast: '#ffffff' },
  ];
  const lanes = Array.from({ length: 12 }, (_, index) => ({
    processId: index + 1, name: `Terminal ${index + 1}`, kind: 'terminal', cwd: '/tmp', command: '',
    x: 12 + index % 4 * 440, y: 12 + Math.floor(index / 4) * 300, width: 420, height: 280,
  }));
  await page.evaluate(lanes => window.postMessage({ type: 'state', connection: 'connected', autoFit: true, columns: 4, lanes, running: lanes.map(lane => lane.processId), fontSize: 13 }, '*'), lanes);
  await page.waitForFunction(() => document.querySelectorAll('.xterm-helper-textarea').length === 12);
  for (const theme of themes) {
    await page.evaluate(theme => {
      const style = document.body.style;
      for (const [key, value] of Object.entries({
        'editor-background': theme.background, 'terminal-background': theme.background,
        foreground: theme.foreground, 'editor-foreground': theme.foreground,
        'descriptionForeground': theme.foreground, focusBorder: theme.focus,
        'editorGroupHeader-tabsBackground': theme.background,
        'panel-border': 'transparent', 'widget-border': 'transparent',
        contrastBorder: theme.contrast ?? 'transparent',
        contrastActiveBorder: theme.contrast ? theme.focus : 'transparent',
        'font-family': 'sans-serif', 'editor-font-family': 'monospace',
      })) style.setProperty(`--vscode-${key}`, value);
    }, theme);
    await page.locator('[data-lane-id="1"] .xterm-helper-textarea').focus();
    const result = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const rgba = color => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
      const luminance = rgb => rgb.slice(0, 3).map(value => { const s = value / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
      const background = rgba(getComputedStyle(document.body).backgroundColor);
      const panes = [...document.querySelectorAll('.lane')].map(element => {
        const style = getComputedStyle(element), border = rgba(style.borderTopColor);
        const a = luminance(border), b = luminance(background);
        const rect = element.getBoundingClientRect();
        return { border, width: style.borderTopWidth, outline: rgba(style.outlineColor), contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
      });
      return { panes, focused: document.activeElement.closest('[data-lane-id]').dataset.laneId };
    });
    assert.equal(result.focused, '1');
    assert.equal(result.panes.length, 12);
    for (const pane of result.panes) {
      assert.equal(pane.width, '1px');
      assert.equal(pane.border[3], 255, `${theme.name}: pane borders must not be transparent`);
      assert.ok(pane.contrast >= 2, `${theme.name}: pane edge should contrast with the canvas`);
    }
    assert.notDeepEqual(result.panes[0].border, result.panes[1].border, `${theme.name}: active pane has a distinct edge`);
    if (theme.contrast) assert.deepEqual(result.panes[1].outline, [255, 255, 255, 255]);
    const before = result.panes.map(pane => pane.rect);
    await page.locator('[data-lane-id="12"] .xterm-helper-textarea').focus();
    const after = await page.locator('.lane').evaluateAll(elements => elements.map(element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
    assert.deepEqual(after, before, `${theme.name}: focusing a pane must not resize or move it`);
    console.log(`PASS ${theme.name}: all 12 pane borders visible; active edge distinct; layout unchanged`);
    if (theme.name === 'dark' && process.env.RONIN_APPEARANCE_SCREENSHOT) await page.screenshot({ path: process.env.RONIN_APPEARANCE_SCREENSHOT });
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
