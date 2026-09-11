import { build } from 'esbuild';
import { mkdir, cp, readdir, rm, access, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
await mkdir('release', { recursive: true });
await rm('dist/native', { recursive: true, force: true });
await mkdir('dist/native/node-pty', { recursive: true });
for (const name of ['lib', 'package.json', 'LICENSE']) {
  await cp(`node_modules/node-pty/${name}`, `dist/native/node-pty/${name}`, { recursive: true });
}
let binary = process.env.RONIN_PTY_BINARY;
if (!binary) {
  for (const candidate of ['build/Release', `prebuilds/${process.platform}-${process.arch}`]) {
    const path = join('node_modules/node-pty', candidate, 'pty.node');
    try { await access(path); binary = path; break; } catch { /* Try the packaged prebuild. */ }
  }
}
if (!binary) throw new Error(`Missing node-pty binary for ${process.platform}-${process.arch}. Rebuild node-pty first.`);
await mkdir('dist/native/node-pty/build/Release', { recursive: true });
await cp(binary, 'dist/native/node-pty/build/Release/pty.node');
if (process.platform === 'darwin') {
  const helper = 'dist/native/node-pty/build/Release/spawn-helper';
  await cp(join(dirname(binary), 'spawn-helper'), helper);
  // node-pty 1.1.0's macOS prebuilds ship this executable with mode 0644.
  await chmod(helper, 0o755);
  const result = spawnSync('xcrun', ['clang', '-Wall', '-Wextra', '-Werror', '-O2', '-mmacosx-version-min=11.0', '-arch', process.arch === 'arm64' ? 'arm64' : 'x86_64', 'scripts/macos-helper.c', '-o', 'dist/native/ronin-helper'], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('macOS helper build failed. Install the Xcode Command Line Tools with xcode-select --install.');
}
await cp('src/ronin.svg', 'dist/ronin.svg');
await cp('src/ronin-icon.png', 'dist/ronin-icon.png');
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
