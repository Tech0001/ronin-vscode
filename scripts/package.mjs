import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const target = `${process.platform}-${process.arch}`;
if (!['linux-x64', 'darwin-arm64', 'darwin-x64'].includes(target)) throw new Error(`Unsupported packaging target: ${target}`);
const env = { ...process.env };
function run(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (target === 'linux-x64') {
  run('scripts/build-linux-pty.mjs');
  env.RONIN_PTY_BINARY = 'build/native/linux-x64/pty.node';
}
const { name, version } = JSON.parse(readFileSync('package.json', 'utf8'));
mkdirSync('release', { recursive: true });
run(require.resolve('@vscode/vsce/vsce'), ['package', '--no-dependencies', '--allow-missing-repository', '--out', `release/${name}-${version}-${target}.vsix`, '--target', target]);
