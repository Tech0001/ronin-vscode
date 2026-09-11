import React, { useState } from 'react';
import type { Lane } from './shared';
import { Icon } from './Icon';
export interface SidebarData { notes: string; tasks: { id: string; text: string; done: boolean }[]; }
export function Sidebar({ data, change, lanes, running, native = false, pinned, pin, close, select, action }: {
  native?: boolean; data: SidebarData; change: (next: SidebarData) => void; lanes: Lane[]; running: number[]; pinned: boolean; pin: () => void; close: () => void; select: (id: number) => void; action: (type: string, id: number) => void;
}) {
  const [task, setTask] = useState('');
  const [filter, setFilter] = useState('');
  return <aside className={`ronin-sidebar ${native ? 'native' : pinned ? 'pinned' : 'overlay'}`} aria-label="Ronin sidebar">
    {!native && <header><strong>Workspace</strong><button className="icon-button" title={pinned ? 'Unpin sidebar' : 'Pin sidebar'} aria-label={pinned ? 'Unpin' : 'Pin'} aria-pressed={pinned} onClick={pin}><Icon name="pin"/></button><button className="icon-button" title="Close sidebar" aria-label="Close Ronin sidebar" onClick={close}><Icon name="close"/></button></header>}
    <div className="sidebar-search"><Icon name="search"/><input aria-label="Filter lanes" placeholder="Find a terminal…" value={filter} onChange={e => setFilter(e.target.value)} /></div>
    <details open><summary><Icon name="terminal"/><span>Lanes</span><span className="count">{lanes.length}</span></summary>
      {(['agent','terminal'] as const).map(kind => <section key={kind}><h4>{kind === 'agent' ? 'Agents' : 'Terminals'}</h4>{lanes.filter(l=>l.kind===kind && l.name.toLowerCase().includes(filter.toLowerCase())).map(l=><div className="sidebar-lane" key={l.processId}><button className="lane-name" onClick={()=>select(l.processId)} title={l.cwd}>{running.includes(l.processId)?'●':'○'} {l.name}</button><button className="icon-button row-action" aria-label={`Edit ${l.name}`} title={`Edit ${l.name}`} onClick={()=>action('edit',l.processId)}><Icon name="edit"/></button>{!running.includes(l.processId)&&<button className="icon-button row-action" title={`Start ${l.name}`} aria-label={`Start ${l.name}`} onClick={()=>action('start',l.processId)}><Icon name="play"/></button>}{l.command&&<button className="icon-button row-action" aria-label={`Run command for ${l.name}`} title={`Run command for ${l.name}`} onClick={()=>action('runAgent',l.processId)}><Icon name="play"/></button>}</div>)}</section>)}
    </details>
    <details open><summary><Icon name="tasks"/><span>Tasks</span><span className="count">{data.tasks.filter(t=>!t.done).length}</span></summary><form onSubmit={e=>{e.preventDefault();if(!task.trim())return;change({...data,tasks:[...data.tasks,{id:Array.from(crypto.getRandomValues(new Uint32Array(4)), n=>n.toString(16)).join('-'),text:task.trim(),done:false}]});setTask('');}}><input aria-label="New task" placeholder="Add a task…" value={task} onChange={e=>setTask(e.target.value)} maxLength={2000}/><button className="icon-button" type="submit" title="Add task" aria-label="Add" disabled={!task.trim()}><Icon name="plus"/></button></form>
      {!data.tasks.length && <p className="sidebar-empty">Keep small next steps here.</p>}
      {data.tasks.map(t=><div className="sidebar-task" key={t.id}><label><input type="checkbox" checked={t.done} onChange={()=>change({...data,tasks:data.tasks.map(item=>item.id===t.id?{...item,done:!item.done}:item)})}/><span style={{textDecoration:t.done?'line-through':undefined}}>{t.text}</span></label><button className="icon-button row-action" title="Delete task" aria-label={`Delete task ${t.text}`} onClick={()=>change({...data,tasks:data.tasks.filter(item=>item.id!==t.id)})}><Icon name="close"/></button></div>)}
    </details>
    <details open><summary><Icon name="note"/><span>Notes</span></summary><textarea aria-label="Workspace notes" placeholder="Ideas, context, things to remember…" value={data.notes} onChange={e=>change({...data,notes:e.target.value})} maxLength={200000}/><small className="save-hint">Saved automatically · this workspace</small></details>
  </aside>;
}
