import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createApp,samplePDF} from '../server.mjs';
import {JobQueue} from '../jobs.mjs';
import {TemporaryFiles} from '../files.mjs';

async function client(t,resolver){
 const app=createApp({resolver});app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>app.close());
 const base=`http://127.0.0.1:${app.address().port}`;const home=await fetch(base);const cookie=home.headers.get('set-cookie').split(';')[0];
 const headers={Cookie:cookie,Origin:base,'Content-Type':'application/json'};
 return {base,headers,send:(urls,extra={})=>fetch(base+'/api/batches',{method:'POST',headers,body:JSON.stringify({urls,authorized:true,...extra})}),view:async id=>{const res=await fetch(base+'/api/batches/'+id,{headers});return res.json();}};
}
async function finished(api,id){for(let i=0;i<200;i++){const batch=await api.view(id);if(!batch.active)return batch;await delay(5);}throw new Error('Batch timed out');}
test('batch preserves order, removes duplicates and continues after one failed source',async t=>{
 let active=0,maximum=0;const order=[];
 const api=await client(t,async url=>{active++;maximum=Math.max(active,maximum);order.push(url);await delay(8);active--;return url.includes('missing')?{available:false,provider:'fixture'}:{body:samplePDF(),provider:'fixture',title:url.includes('one')?'المستند الأوَّل':'المستند الأخير'};});
 const one='https://example.org/one.pdf',missing='https://example.org/missing.pdf',three='https://example.org/three.pdf';
 const response=await api.send([one,missing,one,three]);assert.equal(response.status,202);const created=await response.json();assert.equal(created.accepted,3);assert.equal(created.duplicates,1);
 const batch=await finished(api,created.id);assert.deepEqual(order,[one,missing,three]);assert.equal(maximum,1);assert.equal(batch.processed,3);
 assert.deepEqual(batch.items.map(item=>item.status),['ready','unavailable','ready']);
 for(const item of batch.items.filter(item=>item.status==='ready')){const res=await fetch(api.base+item.download,{headers:api.headers});assert.equal(res.status,200);assert.deepEqual(Buffer.from(await res.arrayBuffer()),samplePDF());assert.ok(res.headers.get('content-disposition').includes('filename*=UTF-8'));}
 assert.equal((await fetch(api.base+'/api/batches/'+created.id)).status,404);
});
test('batch validation rejects the whole request before any job is started',async t=>{
 let calls=0;const api=await client(t,async()=>{calls++;return {body:samplePDF()};});
 assert.equal((await api.send(['https://example.org/a.pdf','http://127.0.0.1/'])).status,400);
 assert.equal((await api.send(Array.from({length:21},(_,i)=>'https://example.org/'+i+'.pdf'))).status,400);
 assert.equal((await api.send(['https://example.org/a.pdf'],{authorized:false})).status,400);
 await delay(10);assert.equal(calls,0);
});
test('twenty links are accepted atomically and all can be cancelled',async t=>{
 const api=await client(t,async(_url,_transport,signal)=>{await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return {available:false};});
 const created=await(await api.send(Array.from({length:20},(_,i)=>'https://example.org/'+i+'.pdf'))).json();assert.equal(created.accepted,20);
 const denied=await fetch(api.base+'/api/batches/'+created.id,{method:'DELETE',headers:{...api.headers,Origin:'https://evil.org'}});assert.equal(denied.status,403);
 const original=console.error;console.error=()=>{};
 try{const response=await fetch(api.base+'/api/batches/'+created.id,{method:'DELETE',headers:api.headers});assert.equal(response.status,200);const batch=await response.json();assert.equal(batch.items.length,20);assert.ok(batch.items.every(item=>item.status==='cancelled'));await delay(5);}finally{console.error=original;}
});
test('queue capacity rejection cannot leave a partially submitted batch',()=>{
 const queue=new JobQueue(async()=>({status:'ready'}),{capacity:2,perOwner:2});
 const original=console.error;console.error=()=>{};
 try{assert.throws(()=>queue.submitMany('a',[{},{},{}]));assert.equal(queue.jobs.size,0);}finally{queue.close();console.error=original;}
});
test('temporary files preserve bytes, enforce quota and delete expired entries',async t=>{
 let time=0;const records=new Map();const storage=new TemporaryFiles(records,{now:()=>time,ttl:10,limit:10});t.after(()=>storage.close());
 await storage.put('first',Buffer.from('12345'),{owner:'a'});assert.deepEqual(await storage.read(records.get('first')),Buffer.from('12345'));assert.equal(records.get('first').body,undefined);
 const original=console.error;console.error=()=>{};
 try{await assert.rejects(storage.put('too-large',Buffer.from('123456'),{owner:'a'}));}finally{console.error=original;}
 assert.equal(records.size,1);time=11;await storage.sweep();assert.equal(records.size,0);
 await storage.put('next',Buffer.from('123456'),{owner:'a'});assert.equal(records.size,1);
});

test('completed files remain available while a long batch is actively followed',async t=>{
 let time=0,release;const app=createApp({now:()=>time,ttl:20,resolver:async url=>{if(url.includes('second'))await new Promise(resolve=>release=resolve);return {body:samplePDF(),provider:'fixture'};}});
 app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>{release?.();app.close();});
 const base=`http://127.0.0.1:${app.address().port}`;const home=await fetch(base);const cookie=home.headers.get('set-cookie').split(';')[0];const headers={Cookie:cookie,Origin:base,'Content-Type':'application/json'};
 const created=await(await fetch(base+'/api/batches',{method:'POST',headers,body:JSON.stringify({urls:['https://example.org/first.pdf','https://example.org/second.pdf'],authorized:true})})).json();
 let batch;for(let i=0;i<50;i++){batch=await(await fetch(base+'/api/batches/'+created.id,{headers})).json();if(batch.items[0].status==='ready' && release)break;await delay(2);}
 assert.equal(batch.items[0].status,'ready');
 time=10;await fetch(base+'/api/batches/'+created.id,{headers});time=25;
 const result=await fetch(base+batch.items[0].download,{headers});assert.equal(result.status,200);assert.deepEqual(Buffer.from(await result.arrayBuffer()),samplePDF());
 release();
});
