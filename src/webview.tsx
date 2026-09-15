import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { arrangeTerminalPanels, dropTerminalPanel } from './terminalLayout';
import { Lane, CanvasState, FilePreviewRequest, FilePreviewData } from './shared';
import { FilePreview } from './FilePreview';
import { terminalLinks, terminalLinkMode } from './terminalLinks';
import { ESCAPE_SEQUENCE, SHIFT_ENTER_SEQUENCE, terminalShortcut } from './terminalShortcuts';
import { hasTerminalFileData, terminalDropPaths } from './terminalDrop';
import { currentTerminalTheme } from './terminalTheme';
import { autoFitPanels } from './autoLayout';
import { Icon } from "./Icon";
import '@xterm/xterm/css/xterm.css';
import './webview.css';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void; setState(state: unknown): void };
const vscode = acquireVsCodeApi();
const send = (message: unknown) => vscode.postMessage(message);
let nextPreviewId = 0;
function activateTerminalLink(event: MouseEvent, path: string, id: number) {
  const mode = terminalLinkMode(event);
  if (!mode) return;
  event.preventDefault();
  if (mode === 'preview' && !/^https?:\/\//i.test(path)) {
    window.dispatchEvent(new CustomEvent<FilePreviewRequest>('previewFile', { detail: { requestId: ++nextPreviewId, id, path } }));
  } else send({ type: 'openFile', id, path, mode: 'background' });
}

function TerminalView({ lane, running, fontSize }: { lane: Lane; running: boolean; fontSize: number }) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const live = useRef(running); live.current = running;
  useEffect(() => {
    const fontFamily = () => getComputedStyle(document.body).getPropertyValue('--vscode-editor-font-family').trim() || 'monospace';
    const term = new Terminal({ fontSize, fontFamily: fontFamily(), cursorBlink: true, scrollback: 5000, allowProposedApi: false,
      theme: currentTerminalTheme(),
      linkHandler: { allowNonHttpProtocols: true,
        activate: (event, uri) => { if (/^(file|https?):/i.test(uri)) activateTerminalLink(event, uri, lane.processId); },
        hover: (_, uri) => { host.current!.title = `${uri}\nCtrl-click: preview · Ctrl-Shift-click: background tab`; },
        leave: () => { host.current!.title = ''; }
      }
    });
    const addon = new FitAddon(); term.loadAddon(addon); term.open(host.current!); terminal.current = term; fit.current = addon;
    const themeObserver = new MutationObserver(() => {
      term.options.theme = currentTerminalTheme();
      const nextFont = fontFamily();
      if (term.options.fontFamily !== nextFont) { term.options.fontFamily = nextFont; addon.fit(); }
    });
    for (const element of [document.body, document.documentElement]) themeObserver.observe(element, { attributes: true, attributeFilter: ['class', 'style', 'data-vscode-theme-id', 'data-vscode-theme-kind'] });
    term.attachCustomKeyEventHandler(event => {
      const action = terminalShortcut(event, /Mac/.test(navigator.platform));
      if (!action) return true;
      event.preventDefault(); event.stopPropagation();
      if (event.type === 'keydown') {
        if (action === 'interrupt' && live.current) send({ type: 'input', id: lane.processId, data: '\x03' });
        if (action === 'shiftEnter' && live.current) send({ type: 'input', id: lane.processId, data: SHIFT_ENTER_SEQUENCE });
        if (action === 'escape' && live.current) send({ type: 'input', id: lane.processId, data: ESCAPE_SEQUENCE });
        if (action === 'copy') send({ type: 'copy', id: lane.processId, text: term.getSelection() });
        if (action === 'paste') send({ type: 'pasteRequest', id: lane.processId });
      }
      return false;
    });
    const input = term.onData(data => { if (live.current) send({ type: 'input', id: lane.processId, data }); });
    const resized = term.onResize(({ cols, rows }) => send({ type: 'resize', id: lane.processId, cols, rows }));
    const link = term.registerLinkProvider({ provideLinks(row, callback) {
      callback(terminalLinks(term.buffer.active, term.cols, row).map(link => ({ ...link,
        activate: (event: MouseEvent) => activateTerminalLink(event, link.text, lane.processId),
        hover: () => { host.current!.title = `${link.text}\nCtrl-click: preview · Ctrl-Shift-click: background tab`; },
        leave: () => { host.current!.title = ''; }
      })));
    } });
    // xterm writes parse asynchronously. Serialize resets/replays with live
    // output so a reconnect cannot reset ahead of output still being parsed.
    const renderQueue: any[] = [];
    let rendering = false, disposed = false;
    const renderNext = () => {
      if (rendering || disposed || !renderQueue.length) return;
      rendering = true;
      const m = renderQueue.shift();
      if (m.type === 'reset' || m.type === 'replay') term.reset();
      if (m.type === 'replay' && Number.isInteger(m.cols) && Number.isInteger(m.rows)) term.resize(m.cols,m.rows);
      term.write(m.data ?? '', () => {
        if (disposed) return;
        if (m.type === 'replay') fit.current?.fit();
        rendering = false; renderNext();
      });
    };
    const listener = (event: MessageEvent) => {
      const m = event.data; if (m.id !== lane.processId) return;
      if (['reset', 'replay', 'output'].includes(m.type)) { renderQueue.push(m); renderNext(); }
      if (m.type === 'paste' && live.current) { term.paste(m.data); term.focus(); }
      if (m.type === 'focusTerminal') term.focus();
      if (m.type === 'copyRequest') send({ type: 'copy', id: lane.processId, text: term.getSelection() });
    };
    window.addEventListener('message', listener);
    send({ type: 'attached', id: lane.processId });
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(() => { if (host.current?.clientWidth) addon.fit(); }, 70); });
    observer.observe(host.current!);
    const wheel = (e: WheelEvent) => { if (!e.shiftKey) { e.preventDefault(); e.stopPropagation(); } };
    host.current!.addEventListener('wheel', wheel, { passive: false });
    const el = host.current!;
    return () => { disposed = true; renderQueue.length = 0; clearTimeout(timer); observer.disconnect(); themeObserver.disconnect(); window.removeEventListener('message', listener); el.removeEventListener('wheel', wheel); input.dispose(); resized.dispose(); link.dispose(); term.dispose(); };
  }, [lane.processId]);
  useEffect(() => { if (terminal.current) { terminal.current.options.fontSize = fontSize; fit.current?.fit(); } }, [fontSize]);
  useEffect(() => { if (running && terminal.current) { fit.current?.fit(); send({ type: 'resize', id: lane.processId, cols: terminal.current.cols, rows: terminal.current.rows }); } }, [running]);
  // VS Code requires Shift to send an Explorer drop into a webview. Once it
  // arrives, claim it before xterm and the host's bubbling drag handlers.
  const acceptFileDrag = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasTerminalFileData(e.dataTransfer)) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = live.current ? 'copy' : 'none';
  };
  return <div className="terminal" ref={host} onFocus={() => send({ type: 'focus', id: lane.processId, focused: true })} onBlur={() => send({ type: 'focus', id: lane.processId, focused: false })} onDragEnterCapture={acceptFileDrag} onDragOverCapture={acceptFileDrag} onDropCapture={e => {
    if (!hasTerminalFileData(e.dataTransfer)) return;
    e.preventDefault(); e.stopPropagation();
    if (!live.current) return;
    const paths = terminalDropPaths(e.dataTransfer);
    if (paths.length) { terminal.current?.focus(); send({ type: 'paths', id: lane.processId, paths }); }
  }} />;
}

function App() {
  const [state, setState] = useState<CanvasState>({ lanes: [], running: [], fontSize: 13 });
  const [columns, setColumns] = useState(0);
  const [maximized, setMaximized] = useState<number | null>(null);
  const [autoFit, setAutoFit] = useState(true);
  const [preview, setPreview] = useState<{ request: FilePreviewRequest; data?: FilePreviewData }>();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const initialized = useRef(false);
  const lanesRef = useRef(state.lanes); lanesRef.current = state.lanes;
  const viewport = useRef<HTMLDivElement>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const activeLane = useRef<number | null>(null);
  const focusLane = (id: number | null) => {
    const target = id ?? lanesRef.current[0]?.processId;
    if (target !== undefined) document.querySelector<HTMLTextAreaElement>(`[data-lane-id="${target}"] .xterm-helper-textarea`)?.focus();
  };
  useEffect(() => {
    const previewFile = (event: Event) => {
      const request = (event as CustomEvent<FilePreviewRequest>).detail;
      setPreview({ request });
      send({ type: 'openFile', ...request, mode: 'preview' });
    };
    const receive = (e: MessageEvent) => {
      if (e.data.type === 'filePreview') setPreview(current => current && current.request.requestId === e.data.requestId ? { ...current, data: e.data.preview } : current);
      if (e.data.type === 'state') {
        setState(e.data); setColumns(e.data.columns ?? 0); vscode.setState({ open: true });
        if (!initialized.current) { initialized.current = true; setAutoFit(e.data.autoFit ?? true); }
      }
      if (e.data.type === 'selectLane') { setMaximized(null); requestAnimationFrame(() => { document.querySelector(`[data-lane-id="${e.data.id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); focusLane(e.data.id); }); }
      if (e.data.type === 'activity') setState(s => ({ ...s, lanes: s.lanes.map(l => l.processId === e.data.id ? { ...l, kind: e.data.kind, agentName: e.data.agentName } : l) }));
    };
    window.addEventListener('previewFile', previewFile);
    window.addEventListener('message', receive); send({ type: 'ready' });
    return () => { window.removeEventListener('previewFile', previewFile); window.removeEventListener('message', receive); cleanup.current?.(); };
  }, []);
  const commit = (lanes: Lane[]) => { lanesRef.current = lanes; setState(s => ({ ...s, lanes })); send({ type: 'layout', lanes }); };
  const changeAutoFit = (value: boolean) => { setAutoFit(value); send({ type: 'autoFit', value }); };
  useEffect(() => {
    const observer = new ResizeObserver(() => { const el = viewport.current!; setSize({ width: el.clientWidth, height: el.clientHeight }); });
    observer.observe(viewport.current!); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!initialized.current || !autoFit || !size.width || !size.height || maximized !== null || cleanup.current) return;
    const next = autoFitPanels(lanesRef.current, size.width, size.height, columns);
    if (next.some((l,i) => ['x','y','width','height'].some(k => l[k as 'x'] !== lanesRef.current[i][k as 'x']))) commit(next);
  }, [autoFit, columns, size.width, size.height, state.lanes.length, maximized]);
  const arrange = () => { changeAutoFit(false); setMaximized(null); commit(arrangeTerminalPanels(lanesRef.current, viewport.current?.clientWidth ?? 1200, columns)); };
  const reset = () => {
    setMaximized(null); changeAutoFit(true);
    commit(autoFitPanels(lanesRef.current, size.width, size.height, columns));
  };
  const begin = (lane: Lane, event: React.PointerEvent, resize = false) => {
    if (maximized !== null || event.button !== 0 || (event.target as Element).closest('button')) return;
    event.preventDefault(); cleanup.current?.();
    if (resize) changeAutoFit(false);
    const original = lanesRef.current.map(l => ({ ...l }));
    const startX = event.clientX, startY = event.clientY;
    const scrollX = viewport.current!.scrollLeft, scrollY = viewport.current!.scrollTop;
    const move = (e: PointerEvent) => {
      const view = viewport.current!; const box = view.getBoundingClientRect();
      if (e.clientX > box.right - 28) view.scrollLeft += 16;
      if (e.clientY > box.bottom - 28) view.scrollTop += 16;
      if (e.clientX < box.left + 28) view.scrollLeft -= 16;
      if (e.clientY < box.top + 28) view.scrollTop -= 16;
      const dx = e.clientX - startX + view.scrollLeft - scrollX, dy = e.clientY - startY + view.scrollTop - scrollY;
      const changed = resize ? { ...lane, width: Math.max(300, lane.width + dx), height: Math.max(220, lane.height + dy) } : { ...lane, x: Math.max(12, lane.x + dx), y: Math.max(12, lane.y + dy) };
      if (resize) {
        for (const other of original.filter(l => l.processId !== lane.processId)) {
          if (other.x >= lane.x + lane.width && changed.y < other.y + other.height && changed.y + changed.height > other.y) changed.width = Math.min(changed.width, other.x - lane.x - 8);
          if (other.y >= lane.y + lane.height && changed.x < other.x + other.width && changed.x + changed.width > other.x) changed.height = Math.min(changed.height, other.y - lane.y - 8);
        }
      }
      const next = original.map(l => l.processId === lane.processId ? changed : l);
      lanesRef.current = next; setState(s => ({ ...s, lanes: next }));
    };
    const finish = (e?: Event) => {
      const current = lanesRef.current.find(l => l.processId === lane.processId)!;
      let result = e?.type === 'pointerup' ? (resize ? lanesRef.current : dropTerminalPanel(original, current)) : original;
      if (autoFit && !resize) result = autoFitPanels(result, size.width, size.height, columns);
      commit(result);
      if (e?.type === 'pointerup') focusLane(lane.processId);
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish); window.removeEventListener('blur', finish); cleanup.current = null;
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish); window.addEventListener('blur', finish); cleanup.current = finish;
  };
  return <div className="workspace" onFocusCapture={e => {
    const article = (e.target as Element).closest<HTMLElement>('[data-lane-id]');
    if (article) activeLane.current = Number(article.dataset.laneId);
  }} onMouseDownCapture={e => { if ((e.target as Element).closest('.ronin-sidebar, .file-preview')) return; if ((e.target as Element).closest('button')) e.preventDefault(); }} onClickCapture={e => {
    if ((e.target as Element).closest('.ronin-sidebar, .file-preview')) return;
    if (!(e.target as Element).closest('button')) return;
    const article = (e.target as Element).closest<HTMLElement>('[data-lane-id]');
    const id = article ? Number(article.dataset.laneId) : activeLane.current;
    focusLane(id);
    requestAnimationFrame(() => focusLane(id));
  }}><header className="toolbar"><strong>Ronin</strong><button className="icon-button" aria-label="Sidebar" title="Open Ronin sidebar" onClick={() => send({ type: 'showSidebar' })}><Icon name="sidebar"/></button><button className="icon-button" title="Fit terminals to the available space" aria-label={autoFit ? "Auto-fit on" : "Auto-fit off"} aria-pressed={autoFit} onClick={() => changeAutoFit(!autoFit)}><Icon name="fit"/></button><button onClick={() => send({ type: 'add', kind: 'terminal' })}><Icon name="plus"/>Terminal</button><button onClick={() => send({ type: 'add', kind: 'agent' })}><Icon name="agent"/>Agent</button><span className="spacer" /><label>Columns <select value={columns} onChange={e => { const value = Number(e.target.value); setColumns(value); send({ type: 'columns', value }); requestAnimationFrame(() => focusLane(activeLane.current)); }}><option value={0}>Auto</option>{Array.from({ length: 12 }, (_, i) => <option key={i + 1}>{i + 1}</option>)}</select></label><button className="icon-button" aria-label="Arrange" title="Arrange without resizing" onClick={arrange}><Icon name="arrange"/></button><button className="icon-button" aria-label="Reset sizes" title="Reset sizes and fit to canvas" onClick={reset}><Icon name="reset"/></button><small>{state.running.length}/{state.lanes.length} running</small></header>
  {state.connection && state.connection !== 'connected' && <div className="connection-notice" role="status">Reconnecting to background terminals… Input is paused; existing agents may still be running.</div>}
  <div className="canvas-body">
  <div className="viewport" ref={viewport}><div className="canvas" style={{ width: maximized !== null ? '100%' : Math.max(0, ...state.lanes.map(l => l.x + l.width + 12)), height: maximized !== null ? '100%' : Math.max(0, ...state.lanes.map(l => l.y + l.height + 12)) }}>
    {!state.lanes.length && <div className="empty"><h2>Your terminals, together.</h2><p>Add a terminal or agent lane above. Files, Git, and extensions stay in VS Code.</p><p>Drag headers to move. Drop onto a pane to reorder. Slight overlaps snap clear.</p><p>Terminals stay alive through tab closure and VS Code reloads. Use Ronin: Stop Background Terminals to end them.</p></div>}
    {state.lanes.map(lane => <article key={lane.processId} data-lane-id={lane.processId} className="lane" style={maximized === lane.processId ? { inset: 8 } : { left: lane.x, top: lane.y, width: lane.width, height: lane.height, display: maximized !== null ? 'none' : undefined }}>
      <header className="lane-header" onPointerDown={e => begin(lane, e)}><span className={state.running.includes(lane.processId) ? 'dot running' : 'dot'} /><strong title={lane.cwd + '\n' + lane.command}>{lane.name}</strong><small>{lane.agentName ? `Agent · ${lane.agentName}` : lane.kind}</small><span className="spacer" /><button title="Edit name and launch command" onClick={() => send({ type: 'edit', id: lane.processId })} className="icon-button"><Icon name="edit"/></button><button title="Maximize / restore" onClick={() => setMaximized(m => m === lane.processId ? null : lane.processId)} className="icon-button"><Icon name="maximize"/></button><button title="Remove lane" onClick={() => send({ type: 'remove', id: lane.processId })} className="icon-button"><Icon name="close"/></button></header>
      <TerminalView lane={lane} running={state.running.includes(lane.processId) && (!state.connection || state.connection === 'connected')} fontSize={state.fontSize} />
      <footer>{!state.running.includes(lane.processId) && <button onClick={() => send({ type: 'start', id: lane.processId })}>Start</button>}{lane.command && <button title="Run the saved launch command at the shell prompt" onClick={() => send({ type: 'runAgent', id: lane.processId })}>Run command</button>}<span title={lane.cwd}>{lane.cwd}</span></footer><div className="resize" title="Resize terminal" onPointerDown={e => begin(lane, e, true)} />
    </article>)}
  </div></div></div>
  {preview && <FilePreview key={preview.request.requestId} request={preview.request} data={preview.data}
    onClose={() => { const id = preview.request.id; setPreview(undefined); requestAnimationFrame(() => focusLane(id)); }}
    onOpen={() => send({ type: 'openFile', id: preview.request.id, path: preview.request.path, mode: 'background' })} />}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
