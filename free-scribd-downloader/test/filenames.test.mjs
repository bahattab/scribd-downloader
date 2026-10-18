import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {documentFilename,attachmentHeader} from '../filenames.mjs';
import {createApp,samplePDF} from '../server.mjs';

test('Arabic title becomes the downloadable filename',()=>{
 const title='استبيان قياس الطلاق العاطفي';
 assert.equal(documentFilename('https://www.scribd.com/document/845741935/',title+' | PDF | Scribd'),title+'.pdf');
 assert.equal(documentFilename('https://www.scribd.com/document/845741935/'+encodeURIComponent(title.replaceAll(' ','-'))),title+'.pdf');
 const header=attachmentHeader(title+'.pdf');assert.equal(decodeURIComponent(header.split("filename*=UTF-8''")[1]),title+'.pdf');
});
test('filenames cannot inject headers, paths, reserved devices or unbounded names',()=>{
 for(const title of ['../../evil\r\nInjected: true','CON','NUL.pdf','LPT1','a'.repeat(1000),'']){
  const name=documentFilename('https://example.org/a.pdf',title);
  assert.doesNotMatch(name,/[<>:"/\\|?*\r\n]/);assert.ok(name.length<=125);assert.doesNotMatch(name,/^(CON|NUL|LPT1)\.pdf$/i);
  assert.doesNotMatch(attachmentHeader(name),/[\r\n]/);
 }
 assert.equal(documentFilename('https://www.scribd.com/document/845741935/'),'Scribd-845741935.pdf');
});
test('queued API preserves the actual title in the HTTP download response',async t=>{
 const title='استبيان قياس الطلاق العاطفي';const app=createApp({resolver:async()=>({body:samplePDF(),provider:'fixture',title})});
 app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>app.close());
 const base=`http://127.0.0.1:${app.address().port}`;const home=await fetch(base);const cookie=home.headers.get('set-cookie').split(';')[0];
 const response=await fetch(base+'/api/jobs',{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({url:'https://example.org/a.pdf',authorized:true})});const job=await response.json();
 let current;for(let i=0;i<50;i++){current=await(await fetch(base+'/api/jobs/'+job.id,{headers:{Cookie:cookie}})).json();if(current.status==='ready')break;await new Promise(resolve=>setTimeout(resolve,5));}
 assert.equal(current.filename,title+'.pdf');
 const file=await fetch(base+current.download,{headers:{Cookie:cookie}});assert.equal(file.headers.get('content-disposition'),attachmentHeader(title+'.pdf'));
});
