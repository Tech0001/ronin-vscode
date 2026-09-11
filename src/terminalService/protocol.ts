export const PROTOCOL = 1;
export const FRAME_LIMIT = 16 * 1024 * 1024;
export interface RemoteTerminal { id: number; pid: number; running: boolean; agent?: string; generation: string; cols: number; rows: number; }
export interface TerminalSnapshot extends RemoteTerminal { data: string; seq: number; }
export interface StartTerminal { id: number; cwd: string; shell: string; env: Record<string,string>; cols?: number; rows?: number; }
export interface ServiceEvent { event: 'output' | 'state'; id?: number; data?: string; seq?: number; generation?: string; terminals?: RemoteTerminal[]; }
export class JsonLines {
  private pending = '';
  push(chunk: string, receive: (message: any) => void) {
    this.pending += chunk;
    let end: number;
    while ((end = this.pending.indexOf('\n')) >= 0) {
      if (end > FRAME_LIMIT) throw new Error('Terminal service frame exceeded limit.');
      const line = this.pending.slice(0,end); this.pending = this.pending.slice(end+1);
      if (line) receive(JSON.parse(line));
    }
    if (this.pending.length > FRAME_LIMIT) throw new Error('Terminal service frame exceeded limit.');
  }
}
