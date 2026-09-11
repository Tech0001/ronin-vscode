import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
it('Ronin exposes only terminal/workspace commands after the Cultivate split', () => {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  expect(manifest.contributes.commands.map((c: {command: string}) => c.command)).toEqual([
    'ronin.openCanvas', 'ronin.newTerminal', 'ronin.newAgent', 'ronin.interrupt',
    'ronin.shiftEnter', 'ronin.copy', 'ronin.paste', 'ronin.showSidebar',
    'ronin.stopBackgroundTerminals',
  ]);
  expect(manifest.contributes.views.ronin.map((v: {id: string}) => v.id)).toEqual(['ronin.workspace']);
  expect(manifest.dependencies.ajv).toBeUndefined();
});

it('neither the host nor its build includes the automation controllers', () => {
  for (const path of ['src/extension.ts', 'src/sidebarView.tsx', 'src/Sidebar.tsx', 'src/webview.tsx', 'scripts/build.mjs']) {
    const source = readFileSync(resolve(root, path), 'utf8');
    expect(source, path).not.toMatch(/PipelineController|FlowController|openPipeline|openFlow|src\/flows\//);
  }
});

it('the shared README contains no private repository addresses or home paths', () => {
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
  expect(readme).not.toMatch(/https?:\/\/(?:192\.168\.|10\.)|\/home\/pc\//);
});
