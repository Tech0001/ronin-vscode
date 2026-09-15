// Run in an isolated VS Code test profile/workspace with --extensionTestsPath.
const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const until = async predicate => {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('Timed out waiting for terminal color settings');
};
exports.run = async () => {
  const app = await vscode.extensions.getExtension('tech0001.ronin-canvas').activate();
  const config = vscode.workspace.getConfiguration('terminal.integrated');
  const roninConfig = vscode.workspace.getConfiguration('ronin');
  const states = [];
  const send = app.send.bind(app);
  app.send = message => { if (message.type === 'state') states.push(message); send(message); };
  const result = path.join(process.env.RONIN_TEST_RESULTS, 'result.json');
  try {
    app.open();
    await until(() => app.ready);
    assert.deepEqual(app.state().terminalColors, { minimumContrastRatio: 4.5, drawBoldTextInBrightColors: true });
    assert.equal(app.state().selectionStyle, 'solid');
    states.length = 0;
    await config.update('minimumContrastRatio', 1, vscode.ConfigurationTarget.Workspace);
    await until(() => states.at(-1)?.terminalColors.minimumContrastRatio === 1);
    await config.update('drawBoldTextInBrightColors', false, vscode.ConfigurationTarget.Workspace);
    await until(() => states.at(-1)?.terminalColors.drawBoldTextInBrightColors === false);
    await config.update('minimumContrastRatio', 7, vscode.ConfigurationTarget.Workspace);
    await until(() => states.at(-1)?.terminalColors.minimumContrastRatio === 7);
    assert.deepEqual(app.state().terminalColors, { minimumContrastRatio: 7, drawBoldTextInBrightColors: false });
    await roninConfig.update('selectionStyle', 'theme', vscode.ConfigurationTarget.Workspace);
    await until(() => states.at(-1)?.selectionStyle === 'theme');
    await roninConfig.update('selectionStyle', undefined, vscode.ConfigurationTarget.Workspace);
    await until(() => states.at(-1)?.selectionStyle === 'solid');
    fs.writeFileSync(result, JSON.stringify({ ok: true, tests: ['VS Code defaults', 'workspace color overrides', 'solid selection default', 'live selection style changes', 'configuration changes sent live to the canvas'] }));
  } catch (error) {
    fs.writeFileSync(result, JSON.stringify({ ok: false, error: String(error), stack: error.stack }));
    throw error;
  } finally {
    await config.update('minimumContrastRatio', undefined, vscode.ConfigurationTarget.Workspace);
    await config.update('drawBoldTextInBrightColors', undefined, vscode.ConfigurationTarget.Workspace);
    await roninConfig.update('selectionStyle', undefined, vscode.ConfigurationTarget.Workspace);
    await app.service.shutdown();
    app.dispose();
  }
};
