import { readFile } from 'node:fs/promises';

const agents: Record<string, string> = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', aider: 'Aider', opencode: 'OpenCode', goose: 'Goose', 'cursor-agent': 'Cursor' };
export function agentFromArgv(argv: string[]): string | undefined {
  const base = (value: string) => value.replace(/\\/g, '/').split('/').pop()!.toLowerCase().replace(/\.exe$/, '');
  const executable = base(argv[0] ?? '');
  if (agents[executable]) return agents[executable];
  if (!['node', 'nodejs', 'bun', 'python', 'python3'].includes(executable)) return;
  const script = argv.slice(1).find(arg => !arg.startsWith('-')) ?? '';
  if (/\/(@anthropic-ai\/claude-code)\//.test(script)) return 'Claude';
  if (/\/@openai\/codex\//.test(script)) return 'Codex';
  if (/\/@google\/gemini-cli\//.test(script)) return 'Gemini';
  return agents[base(script).replace(/\.(?:js|mjs|cjs|py)$/, '')];
}

/** Read only this terminal's foreground group, never output text or shell history. */
export async function foregroundAgent(shellPid: number, foregroundName: string): Promise<string | undefined> {
  const direct = agentFromArgv([foregroundName]);
  if (direct || process.platform !== 'linux') return direct;
  try {
    const stat = await readFile(`/proc/${shellPid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    const group = Number(fields[5]);
    if (!Number.isInteger(group) || group <= 0 || group === shellPid) return;
    const argv = (await readFile(`/proc/${group}/cmdline`, 'utf8')).split('\0').filter(Boolean);
    return agentFromArgv(argv);
  } catch { return; }
}
