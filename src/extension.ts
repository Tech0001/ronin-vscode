import * as vscode from 'vscode';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { Lane } from './shared';
import { quoteTerminalPaths, terminalFileTarget } from './terminalFiles';
import { SHIFT_ENTER_SEQUENCE } from './terminalShortcuts';
import { TerminalServiceClient } from './terminalService/client';
import { RemoteTerminal, ServiceEvent } from './terminalService/protocol';

interface Session { pty: { pid: number; write: (data:string)=>void; resize: (cols:number,rows:number)=>void; kill: ()=>void }; output: string; agent?: string; generation: string; seq: number; }

export class Ronin {
  panel?: vscode.WebviewPanel;
  sidebarView?: vscode.WebviewView;
  private sidebarReady = false;
  private selectedLane?: number;
  resolveSidebar(view: vscode.WebviewView) {
    this.sidebarView = view; this.sidebarReady = false;
    const root = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
    view.webview.options = { enableScripts: true, localResourceRoots: [root] };
    const nonce = randomBytes(24).toString('hex');
    const script = view.webview.asWebviewUri(vscode.Uri.joinPath(root, 'sidebarView.js'));
    const css = view.webview.asWebviewUri(vscode.Uri.joinPath(root, 'sidebarView.css'));
    view.webview.html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${css}"></head><body><div id="root"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
    const subscriptions = [
      view.webview.onDidReceiveMessage(m => {
        if (m?.type === 'sidebarReady') { this.sidebarReady = true; void view.webview.postMessage({ type: 'state', ...this.state() }); return; }
        if (!['sidebar', 'add', 'selectLane', 'edit', 'start', 'runAgent'].includes(m?.type)) return;
        void (async () => {
          if (['start', 'runAgent'].includes(m.type)) await this.message({ type: 'selectLane', id: m.id });
          await this.message(m);
        })().catch(error => this.error(error));
      }),
      view.onDidChangeVisibility(() => { if (view.visible && this.sidebarReady) void view.webview.postMessage({ type: 'state', ...this.state() }); })
    ];
    view.onDidDispose(() => { subscriptions.forEach(s => s.dispose()); if (this.sidebarView === view) { this.sidebarView = undefined; this.sidebarReady = false; } });
  }
  readonly sessions = new Map<number, Session>();
  lanes: Lane[];
  ready = false;
  focusedId?: number;
  private restored = false;
  private disposed = false;
  private readonly service: TerminalServiceClient;
  private readonly known = new Map<number, RemoteTerminal>();
  private readonly attached = new Set<number>();
  private connectionState: 'connecting' | 'connected' | 'reconnecting' = 'connecting';
  private readonly output = vscode.window.createOutputChannel('Ronin');
  constructor(private readonly context: vscode.ExtensionContext) {
    this.lanes = context.workspaceState.get<Lane[]>('lanes', []);
    const key = context.storageUri?.fsPath ?? context.globalStorageUri.fsPath + ':empty-workspace';
    this.service = new TerminalServiceClient(key, path.join(context.extensionPath, 'dist/terminalDaemon.js'),
      event => this.serviceEvent(event), connected => {
        if (this.disposed) return;
        this.connectionState = connected ? 'connected' : 'reconnecting';
        this.refresh();
        if (connected) void this.synchronize().catch(e=>this.error(e));
      });
  }
  state() { return { connection: this.connectionState, lanes: this.lanes.map(lane => ({ ...lane, kind: this.sessions.get(lane.processId)?.agent ? 'agent' : 'terminal', agentName: this.sessions.get(lane.processId)?.agent })), running: [...this.sessions.keys()], columns: this.context.workspaceState.get<number>('columns', 0), autoFit: this.context.workspaceState.get('autoFit', true), sidebarMode: this.context.workspaceState.get('sidebarMode', 'closed'), sidebar: this.context.workspaceState.get('sidebar', { notes: '', tasks: [] }), fontSize: vscode.workspace.getConfiguration('ronin').get<number>('fontSize', 13) }; }
  private updateTerminals(terminals: RemoteTerminal[]) {
    this.known.clear();
    const live = new Set<number>();
    for (const t of terminals) {
      this.known.set(t.id,t);
      if (!t.running) continue;
      live.add(t.id);
      let s=this.sessions.get(t.id);
      if (!s || s.generation!==t.generation) {
        s={generation:t.generation,seq:-1,output:'',agent:t.agent,pty:{
          pid:t.pid,write:data=>this.write(t.id,data),
          resize:(cols,rows)=>{void this.service.resize(t.id,cols,rows).catch(e=>this.error(e));},
          kill:()=>{void this.closeTerminal(t.id).catch(e=>this.error(e));}
        }};
        this.sessions.set(t.id,s);
      }
      s.agent=t.agent;
    }
    for(const id of this.sessions.keys())if(!live.has(id))this.sessions.delete(id);
    this.refresh();
  }
  private serviceEvent(event: ServiceEvent) {
    if(this.disposed)return;
    if(event.event==='state' && event.terminals)this.updateTerminals(event.terminals);
    if(event.event==='output'){
      const s=this.sessions.get(event.id!);
      if(!s || s.generation!==event.generation || event.seq!<=s.seq)return;
      s.seq=event.seq!;s.output=(s.output+(event.data??'')).slice(-1_000_000);
      this.send({type:'output',id:event.id,data:event.data});
    }
  }
  private async replay(id:number) {
    if(!this.ready || !this.attached.has(id))return;
    await this.service.attach(id,snapshot=>{
      if(this.disposed || !this.ready || !this.attached.has(id))return;
      const s=this.sessions.get(id);
      if(s){s.seq=snapshot.seq;s.output=snapshot.data;}
      this.send({type:'replay',id,data:snapshot.data,cols:snapshot.cols,rows:snapshot.rows});
    });
  }
  private async synchronize() {
    await this.service.list(terminals=>this.updateTerminals(terminals));
    for(const id of this.attached)if(this.known.has(id))await this.replay(id);
  }
  async detectAgents() { await this.service.list(terminals=>this.updateTerminals(terminals)); }
  async save() { await this.context.workspaceState.update('lanes', this.lanes); }
  send(message: any) {
    if (this.ready) void this.panel?.webview.postMessage(message);
    if (this.sidebarReady && ['state', 'activity'].includes(message.type)) void this.sidebarView?.webview.postMessage(message);
  }
  refresh() { this.send({ type: 'state', ...this.state() }); }
  open(existing?: vscode.WebviewPanel) {
    if (!vscode.workspace.isTrusted) { void vscode.window.showWarningMessage('Trust this workspace before starting Ronin.'); return; }
    if (this.panel && !existing) { this.panel.reveal(); return; }
    this.panel = existing ?? vscode.window.createWebviewPanel('ronin.canvas', 'Ronin Canvas', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')] });
    this.ready = false;
    const panel = this.panel;
    panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')] };
    const nonce = randomBytes(24).toString('hex');
    const script = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist/webview.js'));
    const css = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist/webview.css'));
    panel.webview.html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource} 'unsafe-inline'; font-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${css}"></head><body><div id="root"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
    panel.webview.onDidReceiveMessage(message => { void this.message(message).catch(error => this.error(error)); }, undefined, this.context.subscriptions);
    panel.onDidDispose(() => { for(const id of this.attached)void this.service.detach(id).catch(()=>{}); this.attached.clear(); this.panel = undefined; this.ready = false; void vscode.commands.executeCommand('setContext', 'ronin.terminalFocused', false); }, undefined, this.context.subscriptions);
    panel.onDidChangeViewState(() => { if (panel.visible) this.refresh(); }, undefined, this.context.subscriptions);
  }
  error(error: unknown) { if(this.disposed)return; const text = error instanceof Error ? error.message : String(error); this.output.appendLine(text); void vscode.window.showErrorMessage(`Ronin: ${text}`); }
  async add(kind: 'terminal' | 'agent') {
    const name = await vscode.window.showInputBox({ title: `New ${kind} lane`, prompt: 'Lane name', value: kind === 'agent' ? 'Agent' : 'Terminal', validateInput: value => value.trim() ? null : 'Enter a name' });
    if (!name) return;
    const command = kind === 'agent' ? await vscode.window.showInputBox({ title: 'Agent command', prompt: 'Command for Run command. Start opens only a shell.', placeHolder: 'claude, codex resume, or another agent CLI' }) : '';
    if (command === undefined) return;
    let cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
    if ((vscode.workspace.workspaceFolders?.length ?? 0) > 1) {
      const folder = await vscode.window.showWorkspaceFolderPick(); if (!folder) return; cwd = folder.uri.fsPath;
    }
    const directory = await vscode.window.showInputBox({ title: 'Working directory', value: cwd });
    if (directory === undefined) return;
    if (!(await stat(directory)).isDirectory()) throw new Error('Working directory is not a folder.');
    const processId = Math.max(0, ...this.lanes.map(l => l.processId)) + 1;
    const bottom = Math.max(4, ...this.lanes.map(l => l.y + l.height));
    this.lanes.push({ processId, name, kind, command, cwd: directory, x: 12, y: bottom + 8, width: 560, height: 380 });
    await this.save(); this.open(); this.refresh();
  }
  async start(id: number) {
    if (!vscode.workspace.isTrusted) throw new Error('Workspace must be trusted.');
    const lane = this.lanes.find(l => l.processId === id); if (!lane) throw new Error('Unknown lane.');
    const shell = vscode.workspace.getConfiguration('ronin').get<string>('shell') || process.env.SHELL || '/bin/bash';
    const env = Object.fromEntries(Object.entries(process.env).filter((e):e is [string,string]=>typeof e[1]==='string'));
    await this.service.start({id,cwd:lane.cwd,shell,env});
    await this.service.list(terminals=>this.updateTerminals(terminals));
    await this.replay(id);
  }
  write(id: number, text: string) {
    if (!this.service.connected) return;
    void this.service.write(id,text).catch(e=>this.error(e));
  }
  async stop(id: number) { await this.service.write(id,'\x03'); }
  async closeTerminal(id: number) { await this.service.kill(id); }
  async stopBackgroundTerminals() {
    if(await vscode.window.showWarningMessage('Stop all background Ronin terminals and agents for this workspace? Lane definitions are kept.',{modal:true},'Stop all')!=='Stop all')return;
    const terminals=await this.service.list();
    for(const t of terminals)if(t.running)await this.service.kill(t.id);
  }
  async openFile(target: string, id: number) {
    if (/^https?:\/\//.test(target)) { await vscode.env.openExternal(vscode.Uri.parse(target)); return; }
    const lane = this.lanes.find(l => l.processId === id);
    const location = terminalFileTarget(target, lane?.cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir());
    const uri = vscode.Uri.file(path.resolve(location.path));
    const options: vscode.TextDocumentShowOptions = { preview: true, viewColumn: vscode.ViewColumn.Beside, ...(location.line ? { selection: new vscode.Range(location.line - 1, 0, location.line - 1, 0) } : {}) };
    await vscode.commands.executeCommand('vscode.open', uri, options);
  }
  async message(m: any) {
    if (!m || typeof m.type !== 'string') return;
    if (m.type === 'ready') {
      this.ready = true; this.refresh();
      if (this.selectedLane !== undefined) { this.send({ type: 'selectLane', id: this.selectedLane }); this.selectedLane = undefined; }
      if (!this.restored) {
        this.restored = true;
        try { await this.synchronize();
          for (const lane of this.lanes) if (!this.known.has(lane.processId)) { try { await this.start(lane.processId); } catch (e) { this.error(e); } }
        } catch(e) { this.connectionState='reconnecting'; this.refresh(); this.error(e); }
      }
      return;
    }
    if (m.type === 'showSidebar') { await vscode.commands.executeCommand('ronin.workspace.focus'); return; }
    if (m.type === 'selectLane' && Number.isInteger(m.id) && this.lanes.some(l => l.processId === m.id)) {
      this.selectedLane = m.id; this.open();
      if (this.ready) { this.send({ type: 'selectLane', id: m.id }); this.selectedLane = undefined; }
      return;
    }
    if (m.type === 'columns' && Number.isInteger(m.value) && m.value >= 0 && m.value <= 12) { await this.context.workspaceState.update('columns', m.value); return; }
    if (m.type === 'autoFit' && typeof m.value === 'boolean') { await this.context.workspaceState.update('autoFit', m.value); return; }
    if (m.type === 'sidebarMode' && ['closed', 'overlay', 'pinned'].includes(m.value)) { await this.context.workspaceState.update('sidebarMode', m.value); return; }
    if (m.type === 'sidebar' && typeof m.value?.notes === 'string' && m.value.notes.length <= 200000 && Array.isArray(m.value.tasks) && m.value.tasks.length <= 2000 && m.value.tasks.every((t: any) => typeof t.id === 'string' && typeof t.text === 'string' && t.text.length <= 2000 && typeof t.done === 'boolean')) { await this.context.workspaceState.update('sidebar', m.value); return; }
    if (m.type === 'add') { await this.add(m.kind === 'agent' ? 'agent' : 'terminal'); return; }
    if (m.type === 'layout' && Array.isArray(m.lanes)) {
      const ordered: Lane[] = [];
      for (const value of m.lanes) {
        const lane = this.lanes.find(l => l.processId === value.processId);
        if (!lane || ordered.some(l => l.processId === lane.processId)) continue;
        if (![value.x, value.y, value.width, value.height].every(v => typeof v === 'number' && Number.isFinite(v))) continue;
        ordered.push({ ...lane, x: Math.max(12, Math.min(value.x, 100000)), y: Math.max(12, Math.min(value.y, 100000)), width: Math.max(300, Math.min(value.width, 20000)), height: Math.max(220, Math.min(value.height, 20000)) });
      }
      if (ordered.length === this.lanes.length) { this.lanes = ordered; await this.save(); }
      return;
    }
    if (!Number.isInteger(m.id) || !this.lanes.some(l => l.processId === m.id)) return;
    if (m.type === 'focus') {
      if (m.focused) this.focusedId = m.id;
      await vscode.commands.executeCommand('setContext', 'ronin.terminalFocused', Boolean(m.focused));
    }
    if (m.type === 'copy' && typeof m.text === 'string') await vscode.env.clipboard.writeText(m.text);
    if (m.type === 'pasteRequest') this.send({ type: 'paste', id: m.id, data: await vscode.env.clipboard.readText() });
    if (m.type === 'attached') {
      this.attached.add(m.id);
      await this.service.list(terminals=>this.updateTerminals(terminals));
      if(this.known.has(m.id))await this.replay(m.id);
    }
    if (m.type === 'start') { await this.start(m.id); this.send({ type: 'focusTerminal', id: m.id }); }
    if (m.type === 'runAgent') {
      await this.start(m.id);
      const command = this.lanes.find(l => l.processId === m.id)?.command;
      if (command) this.write(m.id, command + '\r');
      this.send({ type: 'focusTerminal', id: m.id });
    }
    if (m.type === 'stop') await this.stop(m.id);
    if (m.type === 'input' && typeof m.data === 'string' && m.data.length <= 1_000_000) this.write(m.id, m.data);
    if (m.type === 'resize' && Number.isInteger(m.cols) && Number.isInteger(m.rows)) this.sessions.get(m.id)?.pty.resize(Math.max(2, Math.min(m.cols, 1000)), Math.max(2, Math.min(m.rows, 500)));
    if (m.type === 'openFile' && typeof m.path === 'string') await this.openFile(m.path, m.id);
    if (m.type === 'paths' && Array.isArray(m.paths) && m.paths.every((p: unknown) => typeof p === 'string')) this.send({ type: 'paste', id: m.id, data: quoteTerminalPaths(m.paths) });
    if (m.type === 'edit') {
      const lane = this.lanes.find(l => l.processId === m.id)!;
      try {
        const name = await vscode.window.showInputBox({ title: 'Edit terminal — name', value: lane.name, validateInput: value => value.trim() ? null : 'Enter a name' });
        if (name === undefined) return;
        const command = await vscode.window.showInputBox({ title: 'Edit terminal — launch command', value: lane.command, prompt: 'Used only by Run command. Start opens a shell. Saving does not execute it.', placeHolder: 'claude --resume, codex resume, npm run dev…' });
        if (command === undefined) return;
        this.lanes = this.lanes.map(current => current.processId === m.id ? { ...current, name: name.trim(), command } : current);
        await this.save(); this.refresh();
      } finally { this.send({ type: 'focusTerminal', id: m.id }); }
    }
    if (m.type === 'remove') {
      const answer = await vscode.window.showWarningMessage('Remove this lane and stop its process?', { modal: true }, 'Remove');
      if (answer !== 'Remove') return;
      await this.closeTerminal(m.id); this.lanes = this.lanes.filter(l => l.processId !== m.id); await this.save(); this.refresh();
    }
  }
  dispose() { this.disposed=true; this.service.dispose(); this.sessions.clear(); this.output.dispose(); }
}

export function activate(context: vscode.ExtensionContext) {
  const ronin = new Ronin(context);
  context.subscriptions.push(ronin,
    vscode.window.registerWebviewViewProvider('ronin.workspace', { resolveWebviewView: view => ronin.resolveSidebar(view) }, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('ronin.showSidebar', () => vscode.commands.executeCommand('ronin.workspace.focus')),
    vscode.commands.registerCommand('ronin.openCanvas', () => ronin.open()),
    vscode.commands.registerCommand('ronin.stopBackgroundTerminals', () => ronin.stopBackgroundTerminals().catch(e=>ronin.error(e))),
    vscode.commands.registerCommand('ronin.interrupt', () => { if (ronin.focusedId !== undefined) ronin.write(ronin.focusedId, '\x03'); }),
    vscode.commands.registerCommand('ronin.shiftEnter', () => { if (ronin.focusedId !== undefined) ronin.write(ronin.focusedId, SHIFT_ENTER_SEQUENCE); }),
    vscode.commands.registerCommand('ronin.copy', () => { if (ronin.focusedId !== undefined) ronin.send({ type: 'copyRequest', id: ronin.focusedId }); }),
    vscode.commands.registerCommand('ronin.paste', async () => { if (ronin.focusedId !== undefined) ronin.send({ type: 'paste', id: ronin.focusedId, data: await vscode.env.clipboard.readText() }); }),
    vscode.commands.registerCommand('ronin.newTerminal', () => ronin.add('terminal').catch(e => ronin.error(e))),
    vscode.commands.registerCommand('ronin.newAgent', () => ronin.add('agent').catch(e => ronin.error(e))),
    vscode.window.registerWebviewPanelSerializer('ronin.canvas', { async deserializeWebviewPanel(panel) { ronin.open(panel); } }),
    vscode.window.registerUriHandler({ handleUri() { ronin.open(); } }),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('ronin')) ronin.refresh(); })
  );
  const restoreTimer = setTimeout(() => { if (ronin.lanes.length && !ronin.panel) ronin.open(); }, 500);
  context.subscriptions.push({ dispose() { clearTimeout(restoreTimer); } });
  return ronin;
}
