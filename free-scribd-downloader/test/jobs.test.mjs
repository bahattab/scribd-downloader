import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {once} from 'node:events';
import {JobQueue} from '../jobs.mjs';
import {createApp,samplePDF} from '../server.mjs';

async function until(check){for(let i=0;i<100;i++){const value=check();if(value)return value;await delay(5);}throw new Error('Condition timed out');}
test('queue enforces concurrency, owner isolation and real FIFO transitions',async t=>{
 const release=[];let active=0,maximum=0;
 const queue=new JobQueue(async payload=>{active++;maximum=Math.max(maximum,active);await new Promise(resolve=>release.push(resolve));active--;return {status:'ready',value:payload};},{concurrency:1});t.after(()=>queue.close());
 const first=queue.submit('a','first'),second=queue.submit('a','second');
 assert.equal(first.status,'queued');assert.equal(second.position,2);assert.equal(queue.view(first.id,'b'),null);
 await until(()=>queue.view(first.id,'a').status==='processing');assert.equal(queue.view(second.id,'a').status,'queued');
 release.shift()();await until(()=>queue.view(second.id,'a').status==='processing');
 assert.equal(queue.view(first.id,'a').value,'first');release.shift()();await until(()=>queue.view(second.id,'a').status==='ready');assert.equal(maximum,1);
});
test('queue cancellation blocks queued work and signals running work',async t=>{
 let started=0;
 const queue=new JobQueue(async(_payload,signal)=>{started++;await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return {status:'ready'};},{concurrency:1});t.after(()=>queue.close());
 const first=queue.submit('a',{}),second=queue.submit('a',{});
 await until(()=>queue.view(first.id,'a').status==='processing');
 assert.equal(queue.cancel(second.id,'b'),null);assert.equal(queue.cancel(second.id,'a').status,'cancelled');
 assert.equal(queue.cancel(first.id,'a').status,'cancelled');await until(()=>queue.active===0);assert.equal(started,1);
});
test('queue expires completed jobs, bounds per-owner capacity and reports failure',async t=>{
 let time=100;const queue=new JobQueue(async()=>{throw new Error('private detail');},{now:()=>time,ttl:20,perOwner:1});t.after(()=>queue.close());
 const original=console.error;console.error=()=>{};
 try {
  const job=queue.submit('a',{});assert.throws(()=>queue.submit('a',{}));
  await until(()=>queue.view(job.id,'a').status==='failed');assert.doesNotMatch(JSON.stringify(queue.view(job.id,'a')),/private detail/);
  time+=21;assert.equal(queue.view(job.id,'a'),null);
 } finally {console.error=original;}
});
test('timeout releases a worker even if a resolver ignores cancellation',async t=>{
 const queue=new JobQueue(async()=>new Promise(()=>{}),{timeout:15});t.after(()=>queue.close());
 const original=console.error;console.error=()=>{};
 try{const job=queue.submit('a',{});await until(()=>queue.view(job.id,'a').status==='failed');assert.equal(queue.active,0);}finally{console.error=original;}
});
test('jobs API creates, polls, downloads and isolates sessions',async t=>{
 const app=createApp({resolver:async()=>({body:samplePDF(),provider:'fixture'})});app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>app.close());
 const base=`http://127.0.0.1:${app.address().port}`;const home=await fetch(base);const cookie=home.headers.get('set-cookie').split(';')[0];
 const headers={Cookie:cookie,Origin:base,'Content-Type':'application/json'};
 const invalid=await fetch(base+'/api/jobs',{method:'POST',headers,body:JSON.stringify({url:'http://127.0.0.1',authorized:true})});assert.equal(invalid.status,400);
 const response=await fetch(base+'/api/jobs',{method:'POST',headers,body:JSON.stringify({url:'https://example.org/a.pdf',authorized:true})});assert.equal(response.status,202);const job=await response.json();
 let result;for(let i=0;i<100;i++){result=await(await fetch(base+'/api/jobs/'+job.id,{headers:{Cookie:cookie}})).json();if(result.status==='ready')break;await delay(5);}assert.equal(result.status,'ready');
 assert.equal((await fetch(base+'/api/jobs/'+job.id)).status,404);
 assert.equal((await fetch(base+'/api/jobs/'+job.id,{method:'DELETE',headers:{Cookie:cookie,Origin:'https://evil.org'}})).status,403);
 const download=await fetch(base+result.download,{headers:{Cookie:cookie}});assert.deepEqual(Buffer.from(await download.arrayBuffer()),samplePDF());
});
