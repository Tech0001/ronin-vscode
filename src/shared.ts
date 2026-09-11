export interface Lane { processId: number; name: string; kind: 'terminal' | 'agent'; agentName?: string; command: string; cwd: string; x: number; y: number; width: number; height: number; }
export interface CanvasState { lanes: Lane[]; running: number[]; fontSize: number; connection?: 'connecting' | 'connected' | 'reconnecting'; }
