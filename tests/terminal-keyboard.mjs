// Exercise real xterm keyboard events in the built webview. RONIN_WEBVIEW_DIST
// also allows testing a backported release without importing unrelated previews.
const { chromium } = await import(process.env.RONIN_PLAYWRIGHT ?? 'playwright');
import assert from 'node:assert/strict';
import path from 'node:path';
const dist = process.env.RONIN_WEBVIEW_DIST ?? path.resolve(import.meta.dirname, '../dist');
const browser = await chromium.launch({ headless: true, executablePath: process.env.RONIN_CHROMIUM ?? '/usr/bin/chromium' });
try {
  for (const platform of ['Linux x86_64', 'MacIntel', 'Win32']) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 650 } });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.setContent('<div id="root"></div>');
    await page.evaluate(platform => {
      Object.defineProperty(navigator, 'platform', { value: platform });
      window.__messages = [];
      window.acquireVsCodeApi = () => ({ postMessage: m => window.__messages.push(m), setState: () => {} });
    }, platform);
    await page.addStyleTag({ path: path.join(dist, 'webview.css') });
    await page.addScriptTag({ path: path.join(dist, 'webview.js') });
    const lane = id => ({ processId: id, name: `Shell ${id}`, kind: 'terminal', command: '', cwd: '/tmp', x: 12 + (id - 1) * 480, y: 12, width: 460, height: 550 });
    const state = { type: 'state', connection: 'connected', autoFit: false, lanes: [lane(1), lane(2)], running: [1, 2], fontSize: 13 };
    const post = m => page.evaluate(m => window.postMessage(m, '*'), m);
    const inputs = () => page.evaluate(() => window.__messages.filter(m => m.type === 'input'));
    const clear = () => page.evaluate(() => { window.__messages = []; });
    await post(state);
    const input = page.locator('[data-lane-id="2"] .xterm-helper-textarea');
    await input.focus();
    await clear();
    await page.keyboard.type('first');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('second');
    assert.equal((await inputs()).map(m => m.data).join(''), 'first\x1b[13;2usecond');
    assert.ok((await inputs()).every(m => m.id === 2), 'only the focused terminal receives input');
    await page.keyboard.press('Enter');
    assert.equal((await inputs()).map(m => m.data).join(''), 'first\x1b[13;2usecond\r');

    await clear();
    await page.keyboard.press('Control+c');
    assert.deepEqual(await inputs(), [{ type: 'input', id: 2, data: '\x03' }]);
    await clear();
    await page.keyboard.press('Escape');
    assert.deepEqual(await inputs(), [{ type: 'input', id: 2, data: '\x1b' }], 'Escape reaches only the focused terminal exactly once');
    assert.ok(await input.evaluate(el => el === document.activeElement), 'Escape does not abandon terminal focus');
    await clear();
    const copyModifier = platform === 'MacIntel' ? 'Meta' : 'Control+Shift';
    await page.keyboard.press(`${copyModifier}+c`);
    await page.keyboard.press(`${copyModifier}+v`);
    const messages = await page.evaluate(() => window.__messages);
    assert.equal(messages.filter(m => m.type === 'copy').length, 1);
    assert.equal(messages.filter(m => m.type === 'pasteRequest').length, 1);
    assert.deepEqual(await inputs(), [], 'clipboard shortcuts must not write terminal input');

    // The shortcut only applies inside xterm, not ordinary editor fields.
    await page.evaluate(() => { const field = document.createElement('textarea'); field.id = 'test-field'; document.body.append(field); field.focus(); });
    await clear();
    await page.keyboard.type('a'); await page.keyboard.press('Shift+Enter'); await page.keyboard.type('b');
    assert.equal(await page.locator('#test-field').inputValue(), 'a\nb');
    await page.keyboard.press('Escape');
    assert.deepEqual(await inputs(), []);

    await post({ ...state, running: [] });
    await page.getByRole('button', { name: 'Start', exact: true }).first().waitFor();
    await input.focus(); await clear();
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.press('Escape');
    assert.deepEqual(await inputs(), [], 'a stopped terminal must not receive queued input');
    assert.deepEqual(errors, []);
    console.log(`PASS ${platform}: Escape, Shift+Enter, plain Enter, focused lane, clipboard, Ctrl+C, text fields, stopped terminal`);
    await page.close();
  }
} finally { await browser.close(); }
