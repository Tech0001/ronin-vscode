// A separate extension-host stand-in: exits without disposing its open connection.
const {TerminalServiceClient}=require(process.argv[2]);
const [key,script,root]=process.argv.slice(3);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const print=text=>"printf '"+Buffer.from(text).toString('hex').replace(/../g,'\\x$&')+"\\n'";
(async()=>{
  let output='';
  const client=new TerminalServiceClient(key,script,event=>{if(event.event==='output')output+=event.data;},()=>{},root);
  const session=await client.start({id:1,cwd:root,shell:'/bin/bash',env:process.env});
  await client.attach(1,s=>{output=s.data;});
  await client.write(1,"export RONIN_PERSIST_VALUE=remembered; "+print('BEFORE_DISCONNECT')+'; sleep 1; '+print('OUTPUT_WHILE_CLOSED')+'\r');
  for(let i=0;i<100&&!output.includes('BEFORE_DISCONNECT');i++)await wait(50);
  if(!output.includes('BEFORE_DISCONNECT'))throw new Error('Shell did not produce initial output');
  process.send({pid:session.pid,generation:session.generation});
  process.exit(0);
})().catch(error=>{console.error(error);process.exit(1);});
