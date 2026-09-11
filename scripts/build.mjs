import { build } from 'esbuild';
import { mkdir, cp, readdir } from 'node:fs/promises';
await mkdir('release', { recursive: true });
await mkdir('dist/native/node-pty', { recursive: true });
for (const name of ['lib', 'package.json', 'LICENSE', 'build/Release']) {
  await cp(`node_modules/node-pty/${name}`, `dist/native/node-pty/${name}`, { recursive: true });
}
if (process.env.RONIN_PTY_BINARY) {
  await cp(process.env.RONIN_PTY_BINARY, 'dist/native/node-pty/build/Release/pty.node');
}
await cp('src/ronin.svg', 'dist/ronin.svg');
await mkdir('dist/licenses', { recursive: true });
for (const name of ['@xterm/xterm', '@xterm/addon-fit', 'react', 'react-dom', 'scheduler', 'node-pty']) {
  const license=(await readdir(`node_modules/${name}`)).find(file=>/^license(?:\.md|\.txt)?$/i.test(file));
  if(!license)throw new Error(`Missing license for ${name}`);
  await cp(`node_modules/${name}/${license}`, `dist/licenses/${name.replaceAll('/', '-')}.txt`);
}
// Headless and serialize are from the same xterm.js repository/release.
for (const name of ['headless', 'addon-serialize']) {
  await cp('node_modules/@xterm/xterm/LICENSE', `dist/licenses/@xterm-${name}.txt`);
}
await Promise.all([
  build({ entryPoints: ['src/terminalService/daemon.ts'], bundle: true, platform: 'node', format: 'cjs', plugins: [{ name: 'native-pty', setup(b) { b.onResolve({ filter: /^node-pty$/ }, () => ({ path: './native/node-pty', external: true })); } }], outfile: 'dist/terminalDaemon.js' }),
  build({ entryPoints: ['src/sidebarView.tsx'], bundle: true, platform: 'browser', format: 'iife', outfile: 'dist/sidebarView.js' }),
  build({ entryPoints: ['src/extension.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], plugins: [{ name: 'native-pty', setup(b) { b.onResolve({ filter: /^node-pty$/ }, () => ({ path: './native/node-pty', external: true })); } }], outfile: 'dist/extension.js' }),
  build({ entryPoints: ['src/webview.tsx'], bundle: true, platform: 'browser', format: 'iife', outfile: 'dist/webview.js', loader: { '.css': 'css' } })
]);
