// Open real xterm links with the mouse, close images during active gestures,
// and exercise both local scrollback and SGR input used by full-screen apps.
const { chromium } = await import(process.env.RONIN_PLAYWRIGHT ?? 'playwright');
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { Terminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');
const temp = mkdtempSync('/tmp/ronin-preview-input-');
await build({ entryPoints: ['src/terminalService/mouseEncoding.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: temp + '/encoding.cjs' });
const { preserveMouseEncoding } = require(temp + '/encoding.cjs');
const browser = await chromium.launch({ headless: true, executablePath: process.env.RONIN_CHROMIUM ?? '/usr/bin/chromium' });
const fixture = { path: '/tmp/review.png', image: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="2891"><rect width="1440" height="2891" fill="purple"/></svg>').toString('base64') };
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  page.setDefaultTimeout(8000);
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.setContent('<div id="root"></div>');
  await page.evaluate(() => {
    window.__messages = [];
    window.acquireVsCodeApi = () => ({ postMessage: m => window.__messages.push(m), setState: () => {} });
    document.body.style.cssText = '--vscode-editor-background:#151515;--vscode-foreground:#ddd;--vscode-font-family:sans-serif;--vscode-editor-font-family:monospace';
  });
  await page.addStyleTag({ path: path.resolve('dist/webview.css') });
  await page.addScriptTag({ path: path.resolve('dist/webview.js') });
  const post = message => page.evaluate(message => window.postMessage(message, '*'), message);
  const messages = () => page.evaluate(() => window.__messages);
  const lanes = Array.from({ length: 12 }, (_, i) => ({ processId: i + 1, name: `Agent ${i + 1}`, kind: 'terminal', command: '', cwd: '/tmp', x: 12, y: 12, width: 300, height: 400 }));
  await post({ type: 'state', connection: 'connected', autoFit: true, columns: 6, lanes, running: lanes.map(l => l.processId), fontSize: 13 });
  await page.waitForFunction(() => window.__messages.some(m => m.type === 'resize' && m.id === 12 && m.rows === 23));
  const lane = page.locator('[data-lane-id="12"]');
  const rows = lane.locator('.xterm-rows');
  const link = '/tmp/review.png';
  const input = async () => (await messages()).filter(m => m.type === 'input' && m.id === 12).map(m => m.data);
  for (const mode of ['normal', 'full-screen']) {
    for (const close of ['button', 'Escape', 'Escape during drag', 'backdrop']) {
      let data = Array.from({ length: 80 }, (_, i) => `Scroll line ${i}\r\n`).join('') + link;
      if (mode === 'full-screen') {
        const screen = new Terminal({ cols: 36, rows: 23, allowProposedApi: true });
        const serializer = new SerializeAddon(); screen.loadAddon(serializer);
        const encoding = preserveMouseEncoding(screen);
        await new Promise(resolve => screen.write('\x1b[?1049h\x1b[?1003h\x1b[?1006h' + link, resolve));
        data = serializer.serialize() + encoding(); screen.dispose();
      }
      await post({ type: 'reset', id: 12, data });
      await page.waitForFunction(() => document.querySelector('[data-lane-id="12"] .xterm-rows')?.textContent.includes('/tmp/review.png'));
      const line = rows.locator(':scope > div').filter({ hasText: '/tmp/review.png' }).first();
      const rect = await line.boundingBox();
      await page.mouse.move(5, 5);
      await page.mouse.move(rect.x + 30, rect.y + rect.height / 2);
      await page.waitForTimeout(250);
      await page.keyboard.down('Control');
      await page.mouse.down(); await page.mouse.up();
      await page.keyboard.up('Control');
      await page.getByRole('dialog').waitFor();
      const request = (await messages()).filter(m => m.type === 'openFile').at(-1);
      assert.equal(request.mode, 'preview');
      await post({ type: 'filePreview', requestId: request.requestId, preview: fixture });
      await page.waitForFunction(() => document.querySelector('.file-preview-image img')?.naturalWidth > 0);
      await page.getByRole('button', { name: 'Actual size', exact: true }).click();
      const image = await page.getByRole('region', { name: 'Image preview', exact: true }).boundingBox();
      const inputsBefore = (await input()).length;
      await page.mouse.move(image.x + image.width / 2, image.y + image.height / 2);
      await page.mouse.wheel(0, -100);
      await page.mouse.down();
      await page.mouse.move(image.x + image.width / 2 - 40, image.y + image.height / 2 - 50, { steps: 4 });
      if (close !== 'Escape during drag') await page.mouse.up();
      if (close === 'button') await page.getByRole('button', { name: 'Close preview', exact: true }).click();
      else if (close === 'backdrop') await page.mouse.click(10, 10);
      else await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      if (close === 'Escape during drag') await page.mouse.up();
      assert.equal((await input()).length, inputsBefore, `${mode}/${close}: preview gestures never reach the terminal`);
      await page.waitForFunction(() => document.activeElement?.matches('[data-lane-id="12"] .xterm-helper-textarea'));
      const textBefore = await rows.textContent();
      const target = await rows.locator(':scope > div').nth(4).boundingBox();
      await page.mouse.move(target.x + 40, target.y + target.height / 2);
      const beforeWheel = (await input()).length;
      await page.mouse.wheel(0, -400);
      if (mode === 'normal') {
        await page.waitForFunction(previous => document.querySelector('[data-lane-id="12"] .xterm-rows').textContent !== previous, textBefore);
        assert.equal((await input()).length, beforeWheel, 'local scrolling does not send terminal input');
      } else {
        await page.waitForFunction(count => window.__messages.filter(m => m.type === 'input' && m.id === 12).length > count, beforeWheel);
        assert.match((await input()).at(-1), /^\x1b\[<64;\d+;\d+M$/, `${close}: restored full-screen wheel input stays SGR`);
      }
      // Mouse-reporting apps use Shift-selection; normal terminals select directly.
      const textLine = await rows.locator(':scope > div').filter({ hasText: /Scroll.line|review\.png/ }).first().boundingBox();
      if (mode === 'full-screen') await page.keyboard.down('Shift');
      await page.mouse.move(textLine.x + 1, textLine.y + textLine.height / 2);
      await page.mouse.down(); await page.mouse.move(textLine.x + 105, textLine.y + textLine.height / 2, { steps: 5 }); await page.mouse.up();
      if (mode === 'full-screen') await page.keyboard.up('Shift');
      const copiesBefore = (await messages()).filter(m => m.type === 'copy').length;
      await post({ type: 'copyRequest', id: 12 });
      await page.waitForFunction(count => window.__messages.filter(m => m.type === 'copy').length > count, copiesBefore);
      assert.ok((await messages()).filter(m => m.type === 'copy').at(-1).text.length > 3, `${mode}/${close}: text selection works after closing the image`);
      console.log(`PASS ${mode}: image ${close}, then scroll and select`);
    }
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); rmSync(temp, { recursive: true, force: true }); }
