import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkedURL,providerOf} from './downloader.mjs';

const root=dirname(fileURLToPath(import.meta.url));
const environmentPython=join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
export function runWorker(args,signal) {
  return new Promise((resolve,reject)=>{
    const executable=process.env.EB_WORKER_EXE || process.env.EB_PYTHON || (existsSync(environmentPython)?environmentPython:'python');
    const child=spawn(executable,process.env.EB_WORKER_EXE?args:[join(root,'scribd_worker.py'),...args],{cwd:root,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
    let final=null,stdout='',stderr='';
    const abort=()=>{
      if(child.exitCode!==null)return;
      if(process.platform==='win32' && child.pid){const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>child.kill());}
      else child.kill('SIGKILL');
    };
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    child.stdout.on('data',chunk=>{
      stdout+=chunk.toString();if(stdout.length>65536){child.kill();reject(new Error('Worker output exceeded'));return;}
      let boundary;while((boundary=stdout.indexOf('\n'))!==-1){const line=stdout.slice(0,boundary);stdout=stdout.slice(boundary+1);try{const event=JSON.parse(line);if(event?.event==='result')final=event;}catch{/* Ignore non-protocol progress output. */}}
    });
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-8192);});
    child.on('error',error=>{signal?.removeEventListener('abort',abort);reject(error);});
    child.on('close',code=>{signal?.removeEventListener('abort',abort);if(stderr)console.error('[python.worker]',stderr);if(signal?.aborted)return reject(new Error('Worker cancelled'));if(final)return resolve(final);reject(new Error('Worker exited without a result: '+code));});
  });
}
export async function renderScribd(value,signal,runner=runWorker) {
  let directory;
  try{
    const url=checkedURL(value);if(providerOf(url.href)!=='Scribd')throw new Error('Unsupported source');
    directory=await mkdtemp(join(tmpdir(),'eb-docs-'));
    const output=join(directory,'document.pdf');
    const event=await runner(['--url',url.href,'--output',output,'--authorized'],signal);
    signal?.throwIfAborted();
    const allowed=['setup_required','unavailable','human_required','limit_exceeded','failed'];
    if(!event?.ok)return {status:allowed.includes(event?.status)?event.status:'failed',provider:'Scribd'};
    const info=await stat(output);if(info.size>20*1024*1024)throw new Error('PDF exceeds limit');
    const body=await readFile(output);if(body.subarray(0,5).toString()!=='%PDF-')throw new Error('Invalid PDF');
    return {body,provider:'Scribd',pages:event.pages,title:event.title};
  }catch(error){console.error('[renderScribd]',error);throw error;}
  finally{if(directory){if(dirname(resolve(directory))!==resolve(tmpdir()) || !basename(directory).startsWith('eb-docs-'))throw new Error('Unsafe cleanup path');await rm(directory,{recursive:true,force:true});}}
}
