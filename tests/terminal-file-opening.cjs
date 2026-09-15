// Run with VS Code's --extensionTestsPath in an isolated profile/workspace.
const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const until = async (predicate, label) => {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('Timeout: ' + label);
};
exports.run = async () => {
  const app = await vscode.extensions.getExtension('tech0001.ronin-canvas').activate();
  const root = process.env.RONIN_TEST_RESULTS;
  const file = path.join(root, 'preview file.txt');
  const previews = [];
  const send = app.send.bind(app);
  app.send = message => { if (message.type === 'filePreview') previews.push(message); send(message); };
  try {
    fs.writeFileSync(file, Array.from({ length: 1600 }, (_, i) => `Line ${i + 1}`).join('\n'));
    app.open();
    await until(() => app.ready && app.service.connected, 'canvas ready');
    app.lanes = [{ processId: 1, name: 'Links', kind: 'terminal', command: '', cwd: root, x: 12, y: 12, width: 560, height: 380 }];
    app.refresh();
    const groups = vscode.window.tabGroups.all.length;
    const tabs = vscode.window.tabGroups.activeTabGroup.tabs.length;
    const uri = vscode.Uri.file(file);
    // Quick preview does not create a tab, and follows the source line.
    await app.message({ type: 'openFile', id: 1, path: 'preview file.txt:1400:3', mode: 'preview', requestId: 1 });
    assert.equal(previews[0].preview.line, 1400);
    assert.equal(previews[0].preview.column, 3);
    assert.ok(previews[0].preview.content.includes('Line 1400'));
    assert.equal(previews[0].preview.startLine, 1300);
    assert.ok(previews[0].preview.note.includes('excerpt'));
    assert.equal(vscode.window.tabGroups.activeTabGroup.tabs.length, tabs);
    assert.ok(app.panel.active && app.panel.visible);
    // Preview the actual document model, including unsaved changes.
    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, new vscode.Position(0, 0), 'Unsaved review\n');
    await vscode.workspace.applyEdit(edit);
    await app.openFile(file, 1, 'preview', 2);
    assert.ok(previews.at(-1).preview.content.startsWith('Unsaved review'));
    await app.openFile(path.join(root, 'missing.txt'), 1, 'preview', 3);
    assert.ok(previews.at(-1).preview.error);
    await app.openFile(root, 1, 'preview', 4);
    assert.ok(previews.at(-1).preview.error.includes('folder'));
    const large = path.join(root, 'large.txt');
    fs.writeFileSync(large, 'a'.repeat(2_000_001));
    await app.openFile(large, 1, 'preview', 5);
    assert.ok(previews.at(-1).preview.note.includes('too large'));
    assert.equal(previews.at(-1).preview.content, undefined);
    // Both new and existing file tabs must stay behind the active Ronin canvas.
    await app.openFile(vscode.Uri.file(file).toString() + '#L42C3', 1, 'background');
    await until(() => vscode.window.tabGroups.all.some(g => g.tabs.some(t => t.input.uri?.fsPath === file)), 'background file tab');
    const group = vscode.window.tabGroups.all.find(g => g.tabs.some(t => t.input.uri?.fsPath === file));
    const tab = group.tabs.find(t => t.input.uri?.fsPath === file);
    assert.equal(group.viewColumn, app.panel.viewColumn);
    assert.equal(tab.isActive, false);
    assert.equal(tab.isPreview, false);
    assert.ok(app.panel.active && app.panel.visible, 'Ronin must remain visible and active');
    assert.equal(vscode.window.tabGroups.all.length, groups, 'no split editor groups');
    await app.openFile(file + ':50', 1, 'background');
    assert.ok(app.panel.active && app.panel.visible);
    assert.equal(vscode.window.tabGroups.all.length, groups);
    // The file's requested selection is applied when the background tab is shown.
    const editor = await vscode.window.showTextDocument(uri, { viewColumn: group.viewColumn, preview: false });
    await until(() => editor.selection.active.line === 49, 'linked selection when tab becomes active');
    assert.equal(editor.selection.active.line, 49);
    const doc = await vscode.workspace.openTextDocument(uri);
    await doc.save();
    fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify({ ok: true, tests: ['preview without editor tab', 'line/column and excerpt', 'unsaved edits', 'missing/folder/large files', 'inactive pinned tab in same group', 'canvas remains visible and active', 'existing tab stays in background', 'selection when opening background tab'] }));
  } catch (error) {
    fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify({ ok: false, error: String(error), stack: error.stack }));
    throw error;
  } finally { await app.service.shutdown(); app.dispose(); }
};
