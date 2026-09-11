import { createServer, Socket } from 'node:net';
import { readFile, chmod, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import * as pty from 'node-pty';
import { Terminal } from '@xterm/headless';
import { SerializeAddon } from '@xterm/addon-serialize';
import { foregroundAgent } from '../agentDetection';
import { FRAME_LIMIT, JsonLines, PROTOCOL, RemoteTerminal, StartTerminal } from './protocol';

interface Session {
  id:number; process:pty.IPty; screen:Terminal; serializer:SerializeAddon; running:boolean; generation:string;
  seq:number; pending:string; queued:number; timer?:NodeJS.Timeout; agent?:string;
}
const directory = process.argv[2];
if (!directory || !['linux','darwin'].includes(process.platform)) throw new Error('Ronin terminal service requires a private Linux or macOS runtime directory.');
process.umask(0o077);
const socketPath=join(directory,'service.sock');
const sessions=new Map<number,Session>();
const peers=new Map<Socket,{authenticated:boolean; subscriptions:Set<number>}>();
const metadata=(s:Session):RemoteTerminal=>({id:s.id,pid:s.process.pid,running:s.running,agent:s.agent,generation:s.generation,cols:s.screen.cols,rows:s.screen.rows});
function send(socket:Socket,message:unknown) {
  if(socket.destroyed)return;
  if(socket.writableLength>FRAME_LIMIT){socket.destroy();return;}
  socket.write(JSON.stringify(message)+'\n');
}
function state() {
  for(const [socket,peer]of peers)if(peer.authenticated)send(socket,{event:'state',terminals:[...sessions.values()].map(metadata)});
}
function flush(s:Session) {
  if(s.timer)clearTimeout(s.timer);s.timer=undefined;
  if(!s.pending)return;
  const message={event:'output',id:s.id,generation:s.generation,seq:++s.seq,data:s.pending};s.pending='';
  for(const [socket,peer]of peers)if(peer.authenticated&&peer.subscriptions.has(s.id))send(socket,message);
}
function output(s:Session,data:string) {
  s.queued+=data.length;
  if(s.queued>524288&&s.running)s.process.pause();
  s.screen.write(data,()=>{
    s.queued-=data.length;
    if(s.queued<131072&&s.running)s.process.resume();
    s.pending+=data;
    if(s.pending.length>131072)flush(s);
    else if(!s.timer)s.timer=setTimeout(()=>flush(s),16);
  });
}
async function start(value:StartTerminal) {
  if(!Number.isSafeInteger(value?.id)||value.id<1||typeof value.cwd!=='string'||typeof value.shell!=='string'||!value.shell.startsWith('/')||!value.env||typeof value.env!=='object'||Array.isArray(value.env))throw new Error('Invalid terminal definition.');
  const env:Record<string,string>={};
  for(const [key,v]of Object.entries(value.env))if(typeof v==='string'&&!key.includes('=')&&!key.includes('\0')&&!v.includes('\0'))env[key]=v;
  delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_CHANNEL_FD;delete env.NODE_CHANNEL_SERIALIZATION_MODE;
  const existing=sessions.get(value.id);if(existing?.running)return metadata(existing);
  if(!(await stat(value.cwd)).isDirectory())throw new Error('Working directory is not a directory.');
  const concurrent=sessions.get(value.id);if(concurrent?.running)return metadata(concurrent);
  if(!concurrent&&sessions.size>=256)throw new Error('Terminal service limit reached (256 lanes). Stop the service to clear retired lane history.');
  const cols=dimension(value.cols,80,1000),rows=dimension(value.rows,24,500);
  const process=pty.spawn(value.shell,['-il'],{cwd:value.cwd,env:{...env,TERM:'xterm-256color',COLORTERM:'truecolor'},name:'xterm-256color',cols,rows});
  if(concurrent){if(concurrent.timer)clearTimeout(concurrent.timer);concurrent.screen.dispose();}
  const screen=new Terminal({cols,rows,scrollback:2000,allowProposedApi:true});
  const serializer=new SerializeAddon();screen.loadAddon(serializer);
  const s:Session={id:value.id,process,screen,serializer,running:true,generation:randomUUID(),seq:0,pending:'',queued:0};
  sessions.set(s.id,s);
  // While detached, satisfy terminal device/status queries so interactive CLIs do not stall.
  // When attached, the visible xterm handles those queries as before.
  screen.onData(data=>{if(s.running&&![...peers.values()].some(p=>p.authenticated&&p.subscriptions.has(s.id)))s.process.write(data);});
  process.onData(data=>output(s,data));
  process.onExit(({exitCode})=>{
    s.running=false;s.agent=undefined;output(s,'\r\n[Process exited: '+exitCode+']\r\n');
    screen.write('',()=>{flush(s);state();});
  });
  state();return metadata(s);
}
function dimension(value:unknown,fallback:number,max:number){return Number.isInteger(value)?Math.max(2,Math.min(value as number,max)):fallback;}
async function main(){
  const token=await readFile(join(directory,'token'),'utf8');
  if(!/^[a-f0-9]{64}$/.test(token))throw new Error('Invalid terminal service token.');
  // The launcher holds a kernel flock for the daemon lifetime; only its owner may remove stale sockets.
  await unlink(socketPath).catch(e=>{if(e.code!=='ENOENT')throw e;});
  let closing=false;
  const server=createServer(socket=>{
    socket.setEncoding('utf8');
    const peer={authenticated:false,subscriptions:new Set<number>()};peers.set(socket,peer);
    const timer=setTimeout(()=>{if(!peer.authenticated)socket.destroy();},3000);
    const reader=new JsonLines();
    socket.on('data',chunk=>{
      try{reader.push(String(chunk),m=>{
        if(!m||typeof m!=='object'||Array.isArray(m)||!Number.isSafeInteger(m.rid))throw new Error('Invalid RPC.');
        void request(m).catch(e=>send(socket,{rid:m.rid,error:String(e.message??e)}));
      });}
      catch{socket.destroy();}
    });
    socket.on('error',()=>{});
    socket.on('close',()=>{clearTimeout(timer);peers.delete(socket);});
    async function request(m:any){
      if(!m||!Number.isSafeInteger(m.rid))throw new Error('Invalid RPC.');
      const reply=(value:unknown)=>send(socket,{rid:m.rid,value});
      if(!peer.authenticated){
        const supplied=typeof m.token==='string'?Buffer.from(m.token):Buffer.alloc(0),expected=Buffer.from(token);
        if(m.op!=='hello'||m.version!==PROTOCOL||supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){send(socket,{rid:m.rid,error:'Terminal service authentication or protocol mismatch.'});socket.end();return;}
        peer.authenticated=true;clearTimeout(timer);reply({version:PROTOCOL,pid:process.pid});return;
      }
      if(m.op==='list'){reply([...sessions.values()].map(metadata));return;}
      if(m.op==='start'){reply(await start(m.value));return;}
      if(m.op==='shutdown'){
        reply(true);closing=true;
        for(const s of sessions.values())if(s.running)s.process.kill();
        setTimeout(()=>{for(const client of peers.keys())client.destroy();server.close(()=>process.exit(0));},150);
        return;
      }
      const s=sessions.get(m.id);
      if(m.op==='detach'){peer.subscriptions.delete(m.id);reply(true);return;}
      // Removing a saved lane which was never started is valid too.
      if(m.op==='kill'){if(s?.running)s.process.kill();reply(true);return;}
      if(!s)throw new Error('Unknown terminal.');
      if(m.op==='attach'){
        peer.subscriptions.delete(s.id);
        s.screen.write('',()=>{
          if(socket.destroyed)return;
          flush(s);
          reply({...metadata(s),seq:s.seq,data:s.serializer.serialize({scrollback:2000})});
          peer.subscriptions.add(s.id);
        });return;
      }
      if(m.op==='write'){
        if(!s.running)throw new Error('Terminal has exited.');
        if(typeof m.data!=='string'||m.data.length>1_000_000)throw new Error('Invalid terminal input.');
        s.process.write(m.data);reply(true);return;
      }
      if(m.op==='resize'){
        const cols=dimension(m.cols,s.screen.cols,1000),rows=dimension(m.rows,s.screen.rows,500);
        s.screen.resize(cols,rows);if(s.running)s.process.resize(cols,rows);reply(true);return;
      }
      throw new Error('Unknown terminal service operation.');
    }
  });
  server.on('error',()=>process.exit(1));
  server.listen(socketPath,()=>{void chmod(socketPath,0o600);});
  let detecting=false;
  const tick=setInterval(async()=>{
    if(closing)return;
    if(!peers.size&&![...sessions.values()].some(s=>s.running)){closing=true;server.close(()=>process.exit(0));return;}
    if(detecting)return;detecting=true;
    try{
      let changed=false;
      await Promise.all([...sessions.values()].filter(s=>s.running).map(async s=>{
        let name='';try{name=s.process.process;}catch{return;}
        const agent=await foregroundAgent(s.process.pid,name);
        if(s.running&&s.agent!==agent){s.agent=agent;changed=true;}
      }));
      if(changed)state();
    }finally{detecting=false;}
  },800);
  tick.unref();
  process.on('SIGTERM',()=>{for(const s of sessions.values())if(s.running)s.process.kill();process.exit(0);});
}
void main().catch(()=>process.exit(1));
