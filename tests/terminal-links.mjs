// Real xterm mouse events, wrapped links, and the modal preview in the built UI.
const { chromium } = await import(process.env.RONIN_PLAYWRIGHT ?? 'playwright');
import assert from 'node:assert/strict';
import path from 'node:path';
const dist = path.resolve(import.meta.dirname, '../dist');
const browser = await chromium.launch({ headless: true, executablePath: process.env.RONIN_CHROMIUM ?? '/usr/bin/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.setContent('<div id="root"></div>');
  await page.evaluate(() => {
    document.body.style.cssText = '--vscode-editor-background:#141a10;--vscode-foreground:#a5c895;--vscode-font-family:sans-serif;--vscode-editor-font-family:monospace;--vscode-focusBorder:#a3d977;--vscode-descriptionForeground:#829274';
    window.__messages = [];
    window.acquireVsCodeApi = () => ({ postMessage: m => window.__messages.push(m), setState: () => {} });
  });
  await page.addStyleTag({ path: path.join(dist, 'webview.css') });
  await page.addScriptTag({ path: path.join(dist, 'webview.js') });
  const post = m => page.evaluate(m => window.postMessage(m, '*'), m);
  const messages = () => page.evaluate(() => window.__messages.filter(m => m.type === 'openFile'));
  const lanes = Array.from({ length: 12 }, (_, i) => ({ processId: i + 1, name: `Agent ${i + 1}`, kind: 'terminal', command: '', cwd: '/tmp', x: 12, y: 12, width: 300, height: 400 }));
  await post({ type: 'state', connection: 'connected', autoFit: true, columns: 6, lanes, running: lanes.map(l => l.processId), fontSize: 13 });
  await page.waitForFunction(() => window.__messages.filter(m => m.type === 'resize').length >= 12);
  await page.waitForFunction(() => window.__messages.some(m => m.type === 'resize' && m.id === 12 && m.rows === 23));
  const lane = page.locator('[data-lane-id="1"]');
  const target = '/home/pc/Documents/GitHub/agent-Nova/docs/audit/2026-09-11-fiber-review.md:42:3';
  await post({ type: 'output', id: 1, data: target + '\r\n' });
  await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent.includes('fiber-review'));
  const geometry = () => page.locator('.lane').evaluateAll(elements => elements.map(el => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }));
  const before = await geometry();
  const point = async row => {
    const r = await lane.locator('.xterm-rows > div').nth(row - 1).boundingBox();
    return { x: r.x + 12, y: r.y + r.height / 2 };
  };
  const click = async (row, modifiers = []) => {
    const p = await point(row);
    await page.mouse.move(5, 5);
    await page.mouse.move(p.x + 12, p.y);
    await page.mouse.move(p.x, p.y);
    // xterm waits for a short hover before requesting links.
    await page.waitForTimeout(250);
    for (const key of modifiers) await page.keyboard.down(key);
    await page.mouse.click(p.x, p.y);
    for (const key of [...modifiers].reverse()) await page.keyboard.up(key);
  };
  await click(2);
  assert.equal((await messages()).length, 0, 'plain click must not open a link');
  await click(2, ['Control']);
  await page.getByRole('dialog').waitFor();
  let request = (await messages()).at(-1);
  assert.equal(request.path, target, 'clicking the continuation row opens the complete path');
  assert.equal(request.mode, 'preview');
  await post({ type: 'filePreview', requestId: request.requestId, preview: { path: target.split(':')[0], line: 42, column: 3, startLine: 1, content: Array.from({ length: 80 }, (_, i) => i === 41 ? '<script>unsafe()</script> reviewed line' : `Line ${i + 1}`).join('\n') } });
  await page.getByText('<script>unsafe()</script> reviewed line', { exact: true }).waitFor();
  assert.equal(await page.locator('.file-preview-line.selected .file-preview-number').textContent(), '42');
  assert.deepEqual(await geometry(), before, 'overlay must preserve all twelve terminal sizes');
  await page.getByRole('button', { name: 'Open in background tab', exact: true }).click();
  assert.equal((await messages()).at(-1).mode, 'background');
  assert.equal(await page.getByRole('dialog').count(), 1, 'opening a background tab keeps the preview available');
  await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(() => !!document.activeElement.closest('.file-preview')), 'Tab remains in the dialog');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.matches('[data-lane-id="1"] .xterm-helper-textarea'));
  assert.ok(!(await page.evaluate(() => window.__messages)).some(m => m.type === 'input' && m.data === '\x1b'), 'closing a preview must not send Escape to the agent');
  await post({ type: 'filePreview', requestId: request.requestId, preview: { path: target, content: 'stale' } });
  assert.equal(await page.getByRole('dialog').count(), 0, 'late responses must not reopen a closed preview');
  await click(3, ['Control', 'Shift']);
  assert.equal((await messages()).at(-1).path, target);
  assert.equal((await messages()).at(-1).mode, 'background');
  assert.equal(await page.getByRole('dialog').count(), 0);
  // OSC 8 carries a full target even when the visible label wraps independently.
  await post({ type: 'reset', id: 1, data: '\x1b]8;;file:///tmp/full%20path.md#L7\x1b\\short label\x1b]8;;\x1b\\\r\n' });
  await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent.includes('label'));
  const count = (await messages()).length;
  await click(1);
  assert.equal((await messages()).length, count, 'OSC 8 links also require Ctrl');
  await click(1, ['Control']);
  await page.getByRole('dialog').waitFor();
  request = (await messages()).at(-1);
  assert.equal(request.path, 'file:///tmp/full%20path.md#L7');
  await post({ type: 'filePreview', requestId: request.requestId, preview: { path: '/tmp/full path.md', error: 'File does not exist.' } });
  await page.getByRole('alert').waitFor();
  await page.getByRole('button', { name: 'Close preview', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.deepEqual(await geometry(), before);
  assert.deepEqual(errors, []);
  console.log('PASS wrapped paths, Ctrl-click, Ctrl-Shift-click, OSC 8, safe preview text, line highlight, errors, Escape/focus, stale replies, and unchanged 12-pane layout');
} finally { await browser.close(); }
