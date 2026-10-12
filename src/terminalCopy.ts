import { foregroundAgent } from './agentDetection';

/** Decide copy from the live foreground process, not the persistent service's cached agent label. */
export async function terminalCopyAction(
  selection: string,
  shellPid: number | undefined,
  detect: (pid: number) => Promise<string | undefined> = pid => foregroundAgent(pid, '')
): Promise<'clipboard' | 'pi' | 'none'> {
  if (selection) return 'clipboard';
  if (shellPid && await detect(shellPid) === 'Pi') return 'pi';
  return 'none';
}
