// Real built xterm/webview with Explorer's drag payloads. The VS Code host
// requires Shift before these events can reach its iframe (not bypassed here).
const { chromium } = await import(process.env.RONIN_PLAYWRIGHT ?? 'playwright');
import assert from 'node:assert/strict';
import path from 'node:path';
const dist = process.env.RONIN_WEBVIEW_DIST ?? path.resolve(import.meta.dirname, '../dist');
const browser = await chromium.launch({ headless: true, executablePath: process.env.RONIN_CHROMIUM ?? '/usr/bin/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 650 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.setContent('<div id="root"></div>');
  await page.evaluate(() => {
    window.__messages = []; window.__hostDrags = [];
    window.acquireVsCodeApi = () => ({ postMessage: m => {
      window.__messages.push(m);
      // Same existing extension-side quoting/paste round trip. Never execute.
      if (m.type === 'paths') window.postMessage({ type: 'paste', id: m.id,
        data: m.paths.map(p => "'" + p.replace(/'/g, "'\\''") + "'").join(' ') + ' ' }, '*');
    }, setState: () => {} });
    // The host installs bubbling listeners before loading the webview script.
    for (const type of ['dragenter', 'dragover', 'drop']) window.addEventListener(type, () => window.__hostDrags.push(type));
  });
  await page.addStyleTag({ path: path.join(dist, 'webview.css') });
  await page.addScriptTag({ path: path.join(dist, 'webview.js') });
  const lane = id => ({ processId: id, name: `Shell ${id}`, kind: 'terminal', command: '', cwd: '/tmp', x: 12 + (id - 1) * 480, y: 12, width: 460, height: 550 });
  const state = { type: 'state', connection: 'connected', autoFit: false, lanes: [lane(1), lane(2)], running: [1, 2], fontSize: 13 };
  const post = m => page.evaluate(m => window.postMessage(m, '*'), m);
  await post(state);
  const input = page.locator('[data-lane-id="2"] .xterm-helper-textarea');
  await input.waitFor({ state: 'attached' });
  const clear = () => page.evaluate(() => { window.__messages = []; window.__hostDrags = []; });
  const drop = async data => {
    await clear();
    return page.evaluate(data => {
      const dt = new DataTransfer();
      for (const [type, value] of Object.entries(data)) dt.setData(type, value);
      const target = document.querySelector('[data-lane-id="2"] .xterm-screen');
      return ['dragenter', 'dragover', 'drop'].map(type => {
        const e = new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, shiftKey: true });
        target.dispatchEvent(e); return e.defaultPrevented;
      });
    }, data);
  };
  const paths = ['/tmp/image one.png', "/tmp/it's$(id).txt"];
  assert.deepEqual(await drop({ CodeFiles: JSON.stringify(paths), 'text/uri-list': 'file:///tmp/image%20one.png' }), [true, true, true]);
  await page.waitForFunction(() => window.__messages.some(m => m.type === 'input'));
  let messages = await page.evaluate(() => window.__messages);
  assert.deepEqual(messages.filter(m => m.type === 'paths'), [{ type: 'paths', id: 2, paths }]);
  assert.deepEqual(messages.filter(m => m.type === 'input'), [{ type: 'input', id: 2, data: "'/tmp/image one.png' '/tmp/it'\\''s$(id).txt' " }]);
  assert.equal(await input.evaluate(el => el === document.activeElement), true);
  assert.deepEqual(await page.evaluate(() => window.__hostDrags), [], 'claimed file events never bubble to the host');

  // Many agents enable bracketed paste. Keep xterm's paste protocol intact.
  await post({ type: 'output', id: 2, data: '\x1b[?2004hREADY' });
  await page.waitForFunction(() => document.querySelector('[data-lane-id="2"] .xterm-rows').textContent.includes('READY'));
  await drop({ 'application/vnd.code.uri-list': 'file:///tmp/a.txt\r\nfile:///tmp/b.png', 'text/uri-list': 'file:///tmp/a.txt' });
  await page.waitForFunction(() => window.__messages.some(m => m.type === 'input'));
  assert.deepEqual(await page.evaluate(() => window.__messages.filter(m => m.type === 'input')),
    [{ type: 'input', id: 2, data: "\x1b[200~'/tmp/a.txt' '/tmp/b.png' \x1b[201~" }]);

  for (const payload of [{ ResourceURLs: '["file:///tmp/third.txt"]' }, { CodeEditors: '[{"resource":{"scheme":"file","path":"/tmp/third.txt"}}]' }]) {
    await drop(payload);
    await page.waitForFunction(() => window.__messages.some(m => m.type === 'input'));
    assert.deepEqual(await page.evaluate(() => window.__messages.filter(m => m.type === 'paths')),
      [{ type: 'paths', id: 2, paths: ['/tmp/third.txt'] }]);
  }
  await drop({ 'text/uri-list': 'file:///tmp/bad%0aname' });
  assert.deepEqual(await page.evaluate(() => window.__messages.filter(m => ['input', 'paths'].includes(m.type))), []);
  assert.deepEqual(await drop({ 'text/plain': 'arbitrary text' }), [false, false, false], 'non-file drags are not claimed');

  for (const next of [{ ...state, connection: 'reconnecting' }, { ...state, running: [] }]) {
    await post(next);
    if (next.running.length) await page.getByRole('status').waitFor();
    else await page.getByRole('button', { name: 'Start', exact: true }).first().waitFor();
    await drop({ CodeFiles: JSON.stringify(paths) });
    assert.deepEqual(await page.evaluate(() => window.__messages.filter(m => ['input', 'paths'].includes(m.type))), [], 'offline input is never queued');
  }
  assert.deepEqual(errors, []);
  console.log('PASS: Explorer multi-file/URI/editor payloads, capture handling, quoting, focus, bracketed paste, no submit, offline safety');
} finally { await browser.close(); }
