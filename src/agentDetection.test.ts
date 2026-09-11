import { expect, it } from 'vitest';
import { agentFromArgv } from './agentDetection';
it('recognizes native agent executables and runtime launchers', () => {
  expect(agentFromArgv(['/some/path/claude', '--resume'])).toBe('Claude');
  expect(agentFromArgv(['/some/path/codex'])).toBe('Codex');
  expect(agentFromArgv(['node', '/opt/node_modules/@anthropic-ai/claude-code/cli.js'])).toBe('Claude');
  expect(agentFromArgv(['node', '/opt/node_modules/@openai/codex/bin/codex.js'])).toBe('Codex');
});
it('does not mistake shell arguments or ordinary programs for agents', () => {
  expect(agentFromArgv(['bash', '-c', 'claude'])).toBeUndefined();
  expect(agentFromArgv(['echo', 'codex'])).toBeUndefined();
  expect(agentFromArgv(['node', 'server.js', 'claude'])).toBeUndefined();
});
