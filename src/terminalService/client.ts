import { Socket, createConnection } from 'node:net';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, lstat, open, readFile, chmod, link, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonLines, PROTOCOL, ServiceEvent, TerminalSnapshot, RemoteTerminal, StartTerminal } from './protocol';

export function runtimeDirectory(key:string,root=tmpdir()){
  return join(root,'ronin-tty-'+(process.getuid?.()??'user')+'-'+createHash('sha256').update(key).digest('hex').slice(0,20));
}
interface Pending { resolve:(v:any)=>void; reject:(e:Error)=>void; timer:NodeJS.Timeout; receive?:(v:any)=>void; }
export class TerminalServiceClient {
  readonly directory:string;
  connected=false;
  private socket?:Socket;
  private pending=new Map<number,Pending>();
  private counter=0;
  private connecting?:Promise<void>;
  private reconnect?:NodeJS.Timeout;
  private closed=false;
  private token='';
  constructor(key:string,private script:string,private event:(m:ServiceEvent)=>void,private connection:(up:boolean)=>void,root?:string,private executable=process.execPath){
    this.directory=runtimeDirectory(key,root);
  }
  private async prepare(){
    if(process.platform!=='linux')throw new Error('Background terminal service currently supports Linux only.');
    await mkdir(this.directory,{recursive:true,mode:0o700});
    const info=await lstat(this.directory);
    if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid!())throw new Error('Unsafe terminal service directory.');
    await chmod(this.directory,0o700);
    const tokenPath=join(this.directory,'token');
    // Publish a fully written token atomically; two first-time clients can race.
    const candidate=join(this.directory,'token-'+randomBytes(12).toString('hex'));
    try{
      const file=await open(candidate,'wx',0o600);
      try{await file.writeFile(randomBytes(32).toString('hex'));}finally{await file.close();}
      try{await link(candidate,tokenPath);}catch(e:any){if(e.code!=='EEXIST')throw e;}
    }finally{await unlink(candidate).catch(()=>{});}
    const tokenInfo=await lstat(tokenPath);
    if(!tokenInfo.isFile()||tokenInfo.isSymbolicLink()||tokenInfo.uid!==process.getuid!()||(tokenInfo.mode&0o077))throw new Error('Unsafe terminal service token file.');
    this.token=await readFile(tokenPath,'utf8');
    if(!/^[a-f0-9]{64}$/.test(this.token))throw new Error('Invalid terminal service token.');
  }
  async connect(){
    if(this.closed)throw new Error('Terminal client disposed.');
    if(this.connected)return;
    if(!this.connecting)this.connecting=this.establish().catch(error=>{if(!this.closed)this.scheduleReconnect();throw error;}).finally(()=>{this.connecting=undefined;});
    return this.connecting;
  }
  private async establish(){
    await this.prepare();
    try{await this.openSocket();}
    catch(e:any){
      if(!['ENOENT','ECONNREFUSED'].includes(e.code))throw e;
      // Kernel lock prevents simultaneous reloads/windows from replacing a live service.
      const child=spawn('/usr/bin/flock',['--nonblock',join(this.directory,'daemon.lock'),this.executable,this.script,this.directory],{
        detached:true,stdio:'ignore',cwd:tmpdir(),env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}
      });
      child.on('error',()=>{});child.unref();
      let last:unknown=e;
      for(let i=0;i<60&&!this.closed;i++){
        await new Promise(r=>setTimeout(r,100));
        try{await this.openSocket();last=undefined;break;}catch(error:any){last=error;if(!['ENOENT','ECONNREFUSED'].includes(error.code))throw error;}
      }
      if(last)throw new Error('Background terminal service did not start. Existing sessions were not stopped.');
    }
    try{
      await this.rpc({op:'hello',version:PROTOCOL,token:this.token});
      this.connected=true;this.connection(true);
    }catch(e){this.socket?.destroy();throw e;}
  }
  private openSocket():Promise<void>{
    return new Promise((resolve,reject)=>{
      const socket=createConnection(join(this.directory,'service.sock'));socket.setEncoding('utf8');
      const timer=setTimeout(()=>socket.destroy(new Error('Terminal service connection timed out.')),3000);
      const failed=(e:Error)=>{clearTimeout(timer);reject(e);};
      socket.once('error',failed);
      socket.once('connect',()=>{
        clearTimeout(timer);socket.off('error',failed);
        if(this.closed){socket.destroy();reject(new Error('Disposed.'));return;}
        this.socket=socket;const reader=new JsonLines();
        socket.on('data',chunk=>{
          try{reader.push(String(chunk),m=>{
            if(m.event){this.event(m);return;}
            const p=this.pending.get(m.rid);if(!p)return;
            this.pending.delete(m.rid);clearTimeout(p.timer);
            if(m.error)p.reject(new Error(m.error));
            else{try{p.receive?.(m.value);p.resolve(m.value);}catch(e){p.reject(e as Error);}}
          });}catch{socket.destroy();}
        });
        socket.on('error',()=>{});
        socket.on('close',()=>{
          if(this.socket!==socket)return;
          this.socket=undefined;const was=this.connected;this.connected=false;
          for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Terminal connection lost; input was not retried.'));}
          this.pending.clear();if(was)this.connection(false);
          if(!this.closed)this.scheduleReconnect();
        });
        resolve();
      });
    });
  }
  private scheduleReconnect(){
    if(this.reconnect)return;
    this.reconnect=setTimeout(()=>{
      this.reconnect=undefined;
      void this.connect().catch(()=>{if(!this.closed)this.scheduleReconnect();});
    },1000);
    this.reconnect.unref();
  }
  private rpc(value:any,receive?:(v:any)=>void):Promise<any>{
    const socket=this.socket;if(!socket||socket.destroyed)return Promise.reject(new Error('Terminal service is disconnected.'));
    const rid=++this.counter;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(rid);reject(new Error('Terminal service request timed out. Input was not retried.'));},10000);
      this.pending.set(rid,{resolve,reject,timer,receive});
      socket.write(JSON.stringify({...value,rid})+'\n');
    });
  }
  async list(receive?:(v:RemoteTerminal[])=>void){await this.connect();return this.rpc({op:'list'},receive) as Promise<RemoteTerminal[]>;}
  async start(value:StartTerminal){await this.connect();return this.rpc({op:'start',value}) as Promise<RemoteTerminal>;}
  async attach(id:number,receive:(v:TerminalSnapshot)=>void){await this.connect();return this.rpc({op:'attach',id},receive);}
  async detach(id:number){if(this.connected)await this.rpc({op:'detach',id});}
  write(id:number,data:string){return this.rpc({op:'write',id,data});}
  resize(id:number,cols:number,rows:number){return this.rpc({op:'resize',id,cols,rows});}
  async kill(id:number){await this.connect();return this.rpc({op:'kill',id});}
  async shutdown(){await this.connect();await this.rpc({op:'shutdown'});this.dispose();}
  dispose(){
    this.closed=true;this.connected=false;
    if(this.reconnect)clearTimeout(this.reconnect);
    this.socket?.destroy();
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Terminal client disposed.'));}
    this.pending.clear();
  }
}
