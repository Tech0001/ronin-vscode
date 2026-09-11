import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Sidebar, SidebarData } from './Sidebar';
import { Lane } from './shared';
import { Icon } from './Icon';
import './webview.css';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const send = (message: unknown) => vscode.postMessage(message);
function Workspace() {
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [running, setRunning] = useState<number[]>([]);
  const [data, setData] = useState<SidebarData>({ notes: '', tasks: [] });
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const m = event.data;
      if (m.type === 'state') { setLanes(m.lanes); setRunning(m.running); setData(m.sidebar); }
      if (m.type === 'activity') setLanes(ls => ls.map(l => l.processId === m.id ? { ...l, kind: m.kind, agentName: m.agentName } : l));
    };
    window.addEventListener('message', receive);
    send({ type: 'sidebarReady' });
    return () => window.removeEventListener('message', receive);
  }, []);
  return <div className="native-workspace">
    <div className="sidebar-content">
      <div className="sidebar-create"><button onClick={() => send({ type: 'add', kind: 'terminal' })}><Icon name="plus"/>Terminal</button><button onClick={() => send({ type: 'add', kind: 'agent' })}><Icon name="agent"/>Agent</button></div>
      <Sidebar native pinned={false} pin={() => {}} close={() => {}} data={data} lanes={lanes} running={running}
        change={value => { setData(value); send({ type: 'sidebar', value }); }}
        select={id => send({ type: 'selectLane', id })}
        action={(type, id) => send({ type, id })}/>
    </div>
    <div className="sidebar-footer"><button type="button" title="Open Ronin Canvas" onClick={() => send({ type: 'openCanvas' })}><Icon name="arrange"/>Open Canvas</button></div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Workspace/>);
