import assert from 'node:assert/strict';
import {mkdtemp,stat,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fork} from 'node:child_process';
import {createRequire} from 'node:module';
import {createConnection} from 'node:net';
import {build} from 'esbuild';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label){
  for(let i=0;i<200;i++){if(await predicate())return;await wait(50);}
  throw new Error('Timeout: '+label);
}
const print=text=>"printf '"+Buffer.from(text).toString('hex').replace(/../g,'\\x$&')+"\\n'";
const root=await mkdtemp(join(process.platform==='darwin'?'/tmp':tmpdir(),'ronin-svc-'));
const bundle=join(root,'client.cjs'),script=resolve('dist/terminalDaemon.js');
await build({entryPoints:['src/terminalService/client.ts'],bundle:true,platform:'node',format:'cjs',outfile:bundle});
const {TerminalServiceClient}=createRequire(import.meta.url)(bundle);
let client,second,third,pid;
try{
  const starters=Array.from({length:4},()=>new TerminalServiceClient(root,script,()=>{},()=>{},root));
  try{await Promise.all(starters.map(c=>c.list()));}
  finally{starters.forEach(c=>c.dispose());}
  console.log('PASS concurrent first connection publishes one token and service');
  const worker=fork(resolve('tests/terminal-client-worker.cjs'),[bundle,root,script,root],{stdio:['ignore','inherit','inherit','ipc']});
  let first;
  worker.on('message',message=>{first=message;});
  await new Promise((resolve,reject)=>{worker.on('error',reject);worker.on('exit',code=>code===0?resolve():reject(new Error('Worker exit: '+code)));});
  assert.ok(first);pid=first.pid;
  process.kill(pid,0);
  await wait(1400);
  let output='',lastSeq=-1,snapshotSeen=false;
  const seen=[];
  client=new TerminalServiceClient(root,script,event=>{
    if(event.event!=='output'||event.id!==1)return;
    assert.ok(snapshotSeen,'snapshot delivered before live output');
    assert.ok(event.seq>lastSeq,'ordered output');lastSeq=event.seq;
    output+=event.data;seen.push(event.data);
  },()=>{},root);
  const list=await client.list();
  assert.equal(list[0].pid,pid);assert.equal(list[0].generation,first.generation);
  await client.attach(1,s=>{output=s.data;lastSeq=s.seq;snapshotSeen=true;});
  assert.ok(output.includes('BEFORE_DISCONNECT'));
  assert.ok(output.includes('OUTPUT_WHILE_CLOSED'));
  await client.write(1,"printf '%s\\n' \"$RONIN_PERSIST_VALUE\"; pwd\r");
  await until(()=>output.includes('remembered')&&output.includes(root),'shell environment and working directory retained');
  console.log('PASS host exit retains identical shell PID, environment, cwd and offline output');

  await client.resize(1,97,33);await client.write(1,'stty size\r');
  await until(()=>output.includes('33 97'),'resize');
  await client.write(1,'sleep 60\r');await wait(200);await client.write(1,'\x03');
  await client.write(1,print('INTERRUPT_RETURNS_SHELL')+'\r');
  await until(()=>output.includes('INTERRUPT_RETURNS_SHELL'),'interrupt');
  assert.equal((await client.list())[0].pid,pid);
  console.log('PASS resize and Ctrl+C preserve shell');

  // A lost socket reconnects; input is never silently queued for replay.
  let reconnected=false;
  second=new TerminalServiceClient(root,script,()=>{},up=>{if(up)reconnected=true;},root);
  await second.list();reconnected=false;
  second.socket.destroy();
  await until(()=>!second.connected,'disconnect noticed');
  await assert.rejects(second.write(1,'MUST_NOT_BE_QUEUED'),'disconnected');
  await until(()=>reconnected,'automatic reconnect');
  assert.equal((await second.list())[0].pid,pid);
  console.log('PASS reconnect does not restart terminal or replay disconnected input');

  assert.equal((await stat(client.directory)).mode&0o777,0o700);
  assert.equal((await stat(join(client.directory,'token'))).mode&0o777,0o600);
  assert.equal((await stat(join(client.directory,'service.sock'))).mode&0o777,0o600);
  const rejected=await new Promise((resolve,reject)=>{
    const socket=createConnection(join(client.directory,'service.sock'));
    socket.setEncoding('utf8');let data='';
    socket.on('connect',()=>socket.write(JSON.stringify({rid:1,op:'hello',version:1,token:'0'.repeat(64)})+'\n'));
    socket.on('data',chunk=>data+=chunk);socket.on('error',reject);
    socket.on('end',()=>resolve(JSON.parse(data)));
  });
  assert.match(rejected.error,/authentication/);
  console.log('PASS private socket/token permissions and authentication');
  await new Promise((resolve,reject)=>{
    const socket=createConnection(join(client.directory,'service.sock'));
    socket.on('connect',()=>socket.write('null\n'));socket.on('error',reject);socket.on('close',resolve);
  });
  assert.equal((await client.list())[0].pid,pid,'malformed peer must not crash service');
  await client.kill(999);

  // Concurrent clients asking for one lane must not launch duplicate shells.
  third=new TerminalServiceClient(root,script,()=>{},()=>{},root);
  const definition={id:2,cwd:root,shell:'/bin/bash',env:process.env};
  const started=await Promise.all([client.start(definition),second.start(definition),third.start(definition)]);
  assert.ok(started.every(s=>s.pid===started[0].pid));
  await client.kill(2);await until(async()=>!(await client.list()).find(s=>s.id===2).running,'second shell exits');
  console.log('PASS concurrent starts are idempotent');

  if(process.platform==='darwin'){
    // Exercise macOS's default shell and exact sysctl argv (including spaces).
    const fixture=join(root,'agent fixtures/node_modules/@openai/codex/bin/codex.js');
    await mkdir(dirname(fixture),{recursive:true});
    await writeFile(fixture,'setInterval(() => {}, 1000);');
    const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
    const zsh=await client.start({id:3,cwd:root,shell:'/bin/zsh',env:{...process.env,ZDOTDIR:root}});
    await client.write(3,`${quote(process.execPath)} ${quote(fixture)}\r`);
    await until(async()=>(await client.list()).find(s=>s.id===3).agent==='Codex','macOS runtime-launched agent detection');
    await client.write(3,'\x03');
    await until(async()=>!(await client.list()).find(s=>s.id===3).agent,'agent exits back to zsh');
    let zshOutput='';
    await client.write(3,print('ZSH_RETURNS_AFTER_INTERRUPT')+'\r');
    await until(async()=>{await client.attach(3,s=>{zshOutput=s.data;});return zshOutput.includes('ZSH_RETURNS_AFTER_INTERRUPT');},'zsh remains interactive');
    await client.detach(3);
    assert.equal((await client.list()).find(s=>s.id===3).pid,zsh.pid);
    await client.kill(3);
    console.log('PASS macOS zsh, runtime-launched agent detection with spaces, and interrupt');
  }

  await client.detach(1);
  await client.write(1,"saved_tty=$(stty -g); stty raw -echo; printf '\\033[6n'; IFS= read -r -d R -t 3 reply; stty \"$saved_tty\"; if [[ $reply == $'\\e['*';'* ]]; then "+print('DETACHED_QUERY_OK')+'; else '+print('DETACHED_QUERY_FAILED')+'; fi\r');
  await wait(500);
  await client.attach(1,s=>{output=s.data;lastSeq=s.seq;});
  assert.ok(output.includes('DETACHED_QUERY_OK'),'detached terminal answers device status query');
  console.log('PASS interactive terminal queries work while detached');

  // Replay captures alternate-screen state while detached, not just plain logs.
  await client.detach(1);snapshotSeen=false;
  await client.write(1,"printf '\\033[?1049h\\033[2J\\033[HALTERNATE_SCREEN'; "+print('ALT_DONE')+'\r');
  await wait(250);
  await client.attach(1,s=>{output=s.data;lastSeq=s.seq;snapshotSeen=true;});
  assert.ok(output.includes('\x1b[?1049h'));assert.ok(output.includes('ALTERNATE_SCREEN'));
  await client.write(1,"printf '\\033[?1049l'; "+print('BACK_ON_NORMAL_SCREEN')+'\r');
  await until(()=>output.includes('BACK_ON_NORMAL_SCREEN'),'alternate screen exit');
  console.log('PASS alternate terminal screen restores on reattachment');

  await client.write(1,'exit\r');
  await until(async()=>!(await client.list()).find(s=>s.id===1).running,'explicit exit');
  await client.attach(1,s=>{assert.ok(s.data.includes('[Process exited: 0]'));});
  console.log('PASS shell exit is retained without automatic relaunch');
}finally{
  second?.dispose();third?.dispose();
  if(client)await client.shutdown().catch(()=>{});
  else {const cleanup=new TerminalServiceClient(root,script,()=>{},()=>{},root);await cleanup.shutdown().catch(()=>cleanup.dispose());}
  if(pid)await until(()=>{try{process.kill(pid,0);return false;}catch{return true;}},'test shell cleanup');
  await wait(300);await rm(root,{recursive:true,force:true});
}
