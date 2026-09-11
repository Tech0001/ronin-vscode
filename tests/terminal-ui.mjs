const {chromium}=await import(process.env.RONIN_PLAYWRIGHT??'playwright');
import assert from 'node:assert/strict';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const browser=await chromium.launch({headless:true,executablePath:process.env.RONIN_CHROMIUM??'/usr/bin/chromium'});
try{
  const page=await browser.newPage({viewport:{width:1000,height:650}});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.setContent('<div id="root"></div>');
  await page.evaluate(()=>{window.__messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.__messages.push(m),setState:()=>{}});});
  await page.addStyleTag({path:path.join(root,'dist/webview.css')});
  await page.addScriptTag({path:path.join(root,'dist/webview.js')});
  const state={type:'state',connection:'connected',autoFit:false,lanes:[{processId:1,name:'Shell',kind:'terminal',command:'',cwd:'/tmp',x:12,y:12,width:900,height:550}],running:[1],fontSize:13};
  const post=m=>page.evaluate(m=>window.postMessage(m,'*'),m);
  await post(state);
  const input=page.locator('.xterm-helper-textarea');await input.focus();
  await page.keyboard.type('works');
  await page.waitForFunction(()=>window.__messages.filter(m=>m.type==='input').map(m=>m.data).join('')==='works');
  await post({...state,connection:'reconnecting'});
  await page.getByRole('status').waitFor();
  await page.evaluate(()=>{window.__messages=[];});await input.focus();
  await page.keyboard.type('do-not-queue');await page.keyboard.press('Control+c');await page.keyboard.press('Shift+Enter');await page.keyboard.press('Escape');
  assert.ok(!(await page.evaluate(()=>window.__messages)).some(m=>m.type==='input'));
  await post({...state,connection:'connected'});
  await page.getByRole('status').waitFor({state:'detached'});
  await page.keyboard.type('back');
  await page.waitForFunction(()=>window.__messages.filter(m=>m.type==='input').map(m=>m.data).join('')==='back');
  console.log('PASS reconnect notice and input pause without replaying keystrokes');

  await page.evaluate(()=>{
    for(const m of [
      {type:'output',data:'STALE OUTPUT\r\n'.repeat(300)},
      {type:'replay',cols:90,rows:30,data:'SNAPSHOT_ONE\r\n'},
      {type:'output',data:'LIVE_AFTER_ONE\r\n'},
      {type:'replay',cols:90,rows:30,data:'SNAPSHOT_TWO\r\n'},
      {type:'output',data:'LIVE_AFTER_TWO\r\n'}
    ])window.postMessage({...m,id:1},'*');
  });
  await page.waitForFunction(()=>document.querySelector('.xterm-rows')?.textContent.includes('LIVE_AFTER_TWO'));
  const text=await page.locator('.xterm-rows').innerText();
  assert.ok(text.includes('SNAPSHOT_TWO'));
  assert.ok(!text.includes('STALE OUTPUT')&&!text.includes('SNAPSHOT_ONE')&&!text.includes('LIVE_AFTER_ONE'));
  assert.equal(text.split('LIVE_AFTER_TWO').length-1,1);
  assert.deepEqual(errors,[]);
  console.log('PASS asynchronous replay/reset ordering preserves only current screen and subsequent output');
}finally{await browser.close();}
