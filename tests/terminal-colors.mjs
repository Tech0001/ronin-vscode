// Check rendered colors and live settings, including text selected with the mouse.
const { chromium } = await import(process.env.RONIN_PLAYWRIGHT ?? 'playwright');
import assert from 'node:assert/strict';
import path from 'node:path';
const dist = path.resolve(import.meta.dirname, '../dist');
const browser = await chromium.launch({ headless: true, executablePath: process.env.RONIN_CHROMIUM ?? '/usr/bin/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 650 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.setContent('<div id="root"></div>');
  await page.evaluate(() => {
    window.__messages = [];
    window.acquireVsCodeApi = () => ({ postMessage: m => window.__messages.push(m), setState: () => {} });
    const colors = {
      'editor-background': '#0b0d11', 'editor-foreground': '#f0b7ca', foreground: '#f0b7ca',
      'terminal-background': '#0b0d11', 'terminal-foreground': '#f0b7ca',
      'terminal-selectionBackground': '#f2388860', 'terminal-selectionForeground': '#0b0d11',
      'terminal-inactiveSelectionBackground': '#f2388830',
      'terminal-ansiGreen': '#17331a', 'terminal-ansiRed': '#f23888', 'terminal-ansiBrightRed': '#ff6aa7',
      'font-family': 'sans-serif', 'editor-font-family': 'monospace',
    };
    for (const [name, value] of Object.entries(colors)) document.body.style.setProperty('--vscode-' + name, value);
  });
  await page.addStyleTag({ path: path.join(dist, 'webview.css') });
  await page.addScriptTag({ path: path.join(dist, 'webview.js') });
  const post = m => page.evaluate(m => window.postMessage(m, '*'), m);
  const state = { type: 'state', connection: 'connected', autoFit: false, lanes: [{ processId: 1, name: 'Colors', kind: 'terminal', command: '', cwd: '/tmp', x: 12, y: 12, width: 900, height: 550 }], running: [1], fontSize: 13 };
  await post(state);
  const input = page.locator('.xterm-helper-textarea');
  await input.waitFor({ state: 'attached' });
  await input.focus();
  await post({ type: 'output', id: 1, data: 'Selected text sample\r\n\x1b[32mLow contrast green\x1b[0m\r\n\x1b[1;31mBold red\x1b[0m\r\n' });
  await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent.includes('Selected'));
  const row = await page.locator('.xterm-rows > div').first().boundingBox();
  await page.mouse.move(row.x + 1, row.y + row.height / 2);
  await page.mouse.down();
  await page.mouse.move(row.x + 150, row.y + row.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.locator('.xterm-decoration-top').first().waitFor();
  const selected = () => page.locator('.xterm-decoration-top').first().evaluate(el => ({ fg: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor }));
  const green = () => page.locator('.xterm-rows > div').nth(1).locator('span').first().evaluate(el => getComputedStyle(el).color);
  const bold = () => page.locator('.xterm-rows > div').nth(2).locator('span').first().evaluate(el => getComputedStyle(el).color);
  const contrast = ({ fg, bg }) => {
    const luminance = css => css.match(/\d+/g).slice(0, 3).map(Number).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    const a = luminance(fg), b = luminance(bg);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  };
  const originalInput = await input.elementHandle();
  assert.deepEqual(await selected(), { fg: 'rgb(11, 13, 17)', bg: 'rgb(242, 56, 136)' }, 'solid mode matches the Ghostty theme selection colors');
  await page.evaluate(() => document.querySelector('.toolbar select').focus());
  assert.deepEqual(await selected(), { fg: 'rgb(11, 13, 17)', bg: 'rgb(242, 56, 136)' }, 'solid selections stay bright when the terminal loses focus');
  await input.focus();
  if (process.env.RONIN_COLORS_SCREENSHOT) await page.screenshot({ path: process.env.RONIN_COLORS_SCREENSHOT });
  const themeState = { ...state, selectionStyle: 'theme' };
  await post(themeState);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.xterm-decoration-top')).backgroundColor === 'rgb(98, 29, 62)');
  assert.ok(contrast(await selected()) >= 4.5, 'default selection has VS Code terminal contrast');
  assert.notEqual(await green(), 'rgb(23, 51, 26)', 'default contrast improves dark ANSI text');
  assert.equal((await selected()).bg, 'rgb(98, 29, 62)', 'theme selection transparency is preserved');
  await post({ ...themeState, terminalColors: { minimumContrastRatio: 1, drawBoldTextInBrightColors: false } });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.xterm-decoration-top')).color === 'rgb(11, 13, 17)');
  assert.equal(await green(), 'rgb(23, 51, 26)', 'contrast 1 preserves original ANSI colors');
  assert.equal(await bold(), 'rgb(242, 56, 136)', 'bright bold can be disabled');
  await post({ ...themeState, terminalColors: { minimumContrastRatio: 7, drawBoldTextInBrightColors: true } });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.xterm-decoration-top')).color !== 'rgb(11, 13, 17)');
  assert.ok(contrast(await selected()) >= 7, 'live selection uses updated contrast');
  assert.equal(await bold(), 'rgb(255, 106, 167)', 'bright bold updates without restarting');
  await page.evaluate(() => document.querySelector('.toolbar select').focus());
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.xterm-decoration-top')).backgroundColor !== 'rgb(98, 29, 62)');
  assert.ok(contrast(await selected()) >= 7, 'inactive selection stays readable');
  await input.focus();
  await page.evaluate(() => document.body.style.setProperty('--vscode-terminal-selectionBackground', '#123456'));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.xterm-decoration-top')).backgroundColor === 'rgb(18, 52, 86)');
  assert.ok(contrast(await selected()) >= 7, 'theme changes also preserve contrast');
  await post(state);
  await page.evaluate(() => document.body.style.setProperty('--vscode-terminal-selectionBackground', 'rgba(242, 56, 136, 0.376)'));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.xterm-decoration-top')).backgroundColor === 'rgb(242, 56, 136)');
  assert.deepEqual(await selected(), { fg: 'rgb(11, 13, 17)', bg: 'rgb(242, 56, 136)' }, 'switching back to solid also works after live theme changes');
  assert.ok(await originalInput.evaluate(el => el === document.querySelector('.xterm-helper-textarea')), 'color changes preserve the terminal instance');
  assert.equal(await page.evaluate(() => window.__messages.filter(m => m.type === 'attached').length), 1);
  assert.deepEqual(errors, []);
  console.log('PASS solid Ghostty-style selection, unfocused selection, theme mode, contrast, ANSI text, bright bold, live settings/theme changes, and terminal preservation');
} finally { await browser.close(); }
