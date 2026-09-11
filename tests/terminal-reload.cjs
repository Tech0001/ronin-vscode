const vscode=require('vscode');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label){for(let i=0;i<200;i++){if(predicate())return;await wait(100);}throw new Error('Timeout: '+label);}
const print=text=>"printf '"+Buffer.from(text).toString('hex').replace(/../g,'\\x$&')+"\\n'";
exports.run=async()=>{
  const app=await vscode.extensions.getExtension('tech0001.ronin-canvas').activate();
  const phase=process.env.RONIN_SERVICE_PHASE;
  const result=path.join(process.env.RONIN_TEST_RESULTS,'service-window-'+phase+'.json');
  try{
    app.lanes=[{processId:101,name:'Reload test',kind:'terminal',command:'',cwd:process.cwd(),x:12,y:12,width:560,height:380}];
    app.open();await until(()=>app.ready&&app.sessions.has(101),'canvas terminal ready');
    await until(()=>app.attached.has(101),'terminal view attached');
    const pid=app.sessions.get(101).pty.pid;
    if(phase==='1'){
      app.write(101,'export RONIN_WINDOW_TEST=still_here; '+print('WINDOW_BEFORE_CLOSE')+'; sleep 2; '+print('WINDOW_WAS_CLOSED')+'\r');
      await until(()=>app.sessions.get(101).output.includes('WINDOW_BEFORE_CLOSE'),'initial output');
      fs.writeFileSync(result,JSON.stringify({ok:true,pid}));
      // Return to VS Code's test runner, which closes the entire test window.
    }else{
      const previous=JSON.parse(fs.readFileSync(path.join(process.env.RONIN_TEST_RESULTS,'service-window-1.json'),'utf8'));
      assert.equal(pid,previous.pid,'full VS Code window closure must preserve PID');
      await until(()=>app.sessions.get(101).output.includes('WINDOW_WAS_CLOSED'),'output while VS Code was closed');
      app.write(101,"printf '%s\\n' \"$RONIN_WINDOW_TEST\"\r");
      await until(()=>app.sessions.get(101).output.includes('still_here'),'same shell environment');
      await app.service.shutdown();
      fs.writeFileSync(result,JSON.stringify({ok:true,pid,tests:['full VS Code window close/reopen','identical live shell','offline output','shell environment retained']}));
    }
  }catch(error){
    fs.writeFileSync(result,JSON.stringify({ok:false,error:String(error),stack:error.stack}));
    await app.service.shutdown().catch(()=>{});throw error;
  }
};
