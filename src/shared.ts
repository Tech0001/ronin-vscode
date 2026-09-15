export interface Lane { processId: number; name: string; kind: 'terminal' | 'agent'; agentName?: string; command: string; cwd: string; x: number; y: number; width: number; height: number; }
export interface CanvasState { lanes: Lane[]; running: number[]; fontSize: number; connection?: 'connecting' | 'connected' | 'reconnecting'; }
export interface FilePreviewRequest { requestId: number; id: number; path: string; }
export interface FilePreviewData {
  path: string;
  line?: number;
  column?: number;
  content?: string;
  startLine?: number;
  note?: string;
  error?: string;
}
