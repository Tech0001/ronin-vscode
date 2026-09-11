// Maintainer-only packaging step. End users do not need Docker or compilers.
import {mkdir,mkdtemp,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url);
if(process.platform!=='linux'||process.arch!=='x64')throw new Error('This packaging target requires Linux x64.');
const pty=dirname(require.resolve('node-pty/package.json'));
const addon=dirname(createRequire(join(pty,'package.json')).resolve('node-addon-api/package.json'));
const scratch=await mkdtemp(join(tmpdir(),'ronin-pty-build-'));
try{
  const result=spawnSync('docker',['run','--rm','--network=none','--cap-drop=ALL','--security-opt=no-new-privileges',
    '--memory=512m','--cpus=2','--user',`${process.getuid()}:${process.getgid()}`,
    '--tmpfs','/tmp:exec,size=256m',
    '--mount',`type=bind,src=${pty},dst=/source,readonly`,
    '--mount',`type=bind,src=${addon},dst=/addon-api,readonly`,
    '--mount',`type=bind,src=${scratch},dst=/output`,
    'node:24-bullseye@sha256:25f3016fcdae6b5d65bd9bcb4064b7e4198ec8d49493fa40d73f9b463d04fb15','bash','-c',[
      'set -eu',
      'mkdir -p /tmp/pty/node_modules/node-addon-api',
      'cp -R /source/src /source/binding.gyp /source/package.json /tmp/pty/',
      'cp -R /addon-api/. /tmp/pty/node_modules/node-addon-api/',
      'cd /tmp/pty',
      'node /usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js rebuild --nodedir=/usr/local --devdir=/tmp/gyp',
      'cp build/Release/pty.node /output/pty.node'
    ].join('\n')],{stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(`Linux PTY build failed (${result.status}).`);
  await mkdir('build/native/linux-x64',{recursive:true});
  await cp(join(scratch,'pty.node'),resolve('build/native/linux-x64/pty.node'));
}finally{await rm(scratch,{recursive:true,force:true});}
