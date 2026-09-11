const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const wait = async (predicate, label) => {
 const end=Date.now()+20000;
 while(Date.now()<end){if(await predicate())return;await new Promise(r=>setTimeout(r,100));}
 throw new Error('Timeout: '+label);
};
exports.run = async () => {
 const ext=vscode.extensions.getExtension('tech0001.ronin-canvas');
 assert.ok(ext);
  const app=await ext.activate();
 try {
  if (process.env.RONIN_RESTORE_ONLY) {
    await wait(()=>app.ready && app.sessions.has(1),'automatic workspace restore');
    assert.equal(app.lanes[0].x,48);
    assert.equal(app.lanes[0].width,560);
    assert.equal(app.state().columns,3);
    app.write(1,"printf '\\x52\\x45\\x53\\x54\\x4f\\x52\\x45_OK\\n'\r");
    await wait(()=>app.sessions.get(1)?.output.includes('RESTORE_OK'),'restored shell works');
    assert.ok(!app.sessions.get(1).output.includes('AGENT_DONE'),'does not automatically restart agent');
    fs.writeFileSync(path.join(process.env.RONIN_TEST_RESULTS,'restore.json'),JSON.stringify({ok:true,tests:['real VS Code restart','positions and sizes','columns','fresh interactive shell','agent not auto-started']}));
    return;
  }
  await vscode.commands.executeCommand('ronin.openCanvas');
  await wait(()=>app.ready,'webview ready');
  app.lanes=[{processId:1,name:'PTY test',kind:'terminal',command:"printf 'SHOULD_NOT_AUTO_RUN\\n'",cwd:process.cwd(),x:12,y:12,width:560,height:380}];
  app.refresh();await app.start(1);
  app.write(1,"printf '\\x52\\x4f\\x4e\\x49\\x4e_PTY_OK\\n'\r");
  await wait(()=>app.sessions.get(1)?.output.includes('RONIN_PTY_OK'),'real PTY output');
  assert.ok(!app.sessions.get(1).output.includes('SHOULD_NOT_AUTO_RUN'),'Start must not execute the saved command');
  const pid=app.sessions.get(1).pty.pid;
  app.panel.dispose();assert.equal(app.sessions.get(1).pty.pid,pid);
  app.open();await wait(()=>app.ready,'reopened canvas');
  assert.equal(app.sessions.get(1).pty.pid,pid);
  app.sessions.get(1).pty.resize(100,35);
  app.write(1,'stty size\r');
  await wait(()=>app.sessions.get(1)?.output.includes('35 100'),'PTY resize');
  await app.save();
  app.write(1,'sleep 30\r');
  await new Promise(r=>setTimeout(r,300));
  await app.stop(1);
  assert.equal(app.sessions.get(1).pty.pid,pid);
  app.write(1,"printf '\\x49\\x4e\\x54\\x45\\x52\\x52\\x55\\x50\\x54_OK\\n'\r");
  await wait(()=>app.sessions.get(1)?.output.includes('INTERRUPT_OK'),'interrupt returns shell prompt');
  await app.message({type:'focus',id:1,focused:true});
  app.write(1,"saved_tty=$(stty -g); stty raw -echo; printf '\\x45\\x53\\x43_READY\\n'; IFS= read -r -N 1 -t 5 escape_key; stty \"$saved_tty\"; printf '\\x45\\x53\\x43_BYTE_%d\\n' \"'$escape_key\"\r");
  await wait(()=>app.sessions.get(1)?.output.includes('ESC_READY'),'raw terminal awaits Escape');
  await vscode.commands.executeCommand('ronin.escape');
  await wait(()=>app.sessions.get(1)?.output.includes('ESC_BYTE_27'),'Escape command sends byte 27 to the PTY');
  assert.equal(app.sessions.get(1).pty.pid,pid,'Escape must not close or replace the shell');
  app.lanes[0].command="printf '\\x41\\x47\\x45\\x4e\\x54_DONE\\n'";
  await app.message({type:'runAgent',id:1});
  await wait(()=>app.sessions.get(1)?.output.includes('AGENT_DONE'),'agent command completes');
  assert.equal(app.sessions.get(1).pty.pid,pid);
  await app.message({type:'columns',value:3});
  await app.message({type:'autoFit',value:false});
  await vscode.commands.executeCommand('ronin.workspace.focus');
  await wait(()=>app.sidebarView && app.sidebarReady,'native sidebar resolves and receives state');
  const liveSession = app.sessions.get(1);
  await app.message({type:'selectLane',id:1});
  assert.equal(app.sessions.get(1),liveSession,'sidebar selection preserves PTY');
  await app.message({type:'sidebarMode',value:'pinned'});
  await app.message({type:'sidebar',value:{notes:'Persistent test note',tasks:[{id:'test',text:'Test task',done:true}]}});
  app.write(1,"bash -c 'exec -a claude sleep 30'\r");
  await wait(async()=>{await app.detectAgents();return app.state().lanes[0].agentName==='Claude';},'recognizes manually launched foreground agent');
  await app.stop(1);
  await wait(async()=>{await app.detectAgents();return app.state().lanes[0].kind==='terminal';},'returns to terminal after agent exit');
  app.panel.dispose();
  // Let queued layout messages drain before setting the reload fixture.
  await new Promise(resolve=>setTimeout(resolve,200));
  app.lanes[0].x=48;app.lanes[0].width=560;await app.save();
  assert.equal(app.state().columns,3);
  // Disposing the extension client must leave its actual shell alive.
  app.dispose();
  process.kill(pid,0);
  // VS Code's extensionTestsPath runs workspace storage in memory, so rebuild
  // the controller against that saved memento to exercise the reload path.
  const restored = new app.constructor(app.context);
  try {
    assert.equal(restored.lanes[0].x,48);
    assert.equal(restored.lanes[0].width,560);
    assert.equal(restored.state().columns,3);
    assert.equal(restored.state().autoFit,false);
    assert.equal(restored.state().sidebarMode,'pinned');
    assert.equal(restored.state().sidebar.notes,'Persistent test note');
    assert.equal(restored.state().sidebar.tasks[0].done,true);
    restored.open();await wait(()=>restored.ready && restored.sessions.has(1),'restored interactive shell');
    assert.equal(restored.sessions.get(1).pty.pid,pid,'reload reattaches to the identical live shell');
    await wait(()=>restored.sessions.get(1)?.output.includes('AGENT_DONE'),'earlier terminal screen replay');
    restored.write(1,"printf '\\x52\\x45\\x53\\x54\\x4f\\x52\\x45_OK\\n'\r");
    await wait(()=>restored.sessions.get(1)?.output.includes('RESTORE_OK'),'restored shell I/O');
    await restored.closeTerminal(1);await wait(()=>!restored.sessions.has(1),'explicit PTY exit');
  } finally {await restored.service.shutdown();restored.dispose();}
  fs.writeFileSync(path.join(process.env.RONIN_TEST_RESULTS,'result.json'),JSON.stringify({ok:true,tests:['extension activation','webview ready','real PTY I/O','tab closure session retention','resize','interrupt preserves shell','agent exit preserves shell','columns persistence','extension client disposal preserves PID','new controller reconnects with screen and shell state']}));
 } catch(e) { fs.writeFileSync(path.join(process.env.RONIN_TEST_RESULTS,'result.json'),JSON.stringify({ok:false,error:String(e),stack:e.stack,state:app.state(),ready:app.ready,panel:!!app.panel}));throw e; }
 finally {if(!app.disposed)await app.service.shutdown();app.dispose();}
};
