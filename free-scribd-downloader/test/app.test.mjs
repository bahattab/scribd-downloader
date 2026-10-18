import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {checkedURL,publicAddress,publicPDFLinks,providerOf,resolveDocument,fetchPublic} from '../downloader.mjs';
import {createApp,samplePDF} from '../server.mjs';

const pdf=samplePDF();
const remote=(body,headers={'content-type':'application/pdf'},url='https://example.org/test.pdf')=>({body,headers,url});

test('rejects local addresses and alternative URL encodings',()=>{
 for(const value of ['file:///etc/passwd','http://example.org','https://127.1','https://2130706433','https://0x7f000001','https://[::1]','https://user:secret@example.org','https://example.org:8443','https://localhost','https://example.org.']) assert.throws(()=>checkedURL(value),value);
 for(const ip of ['127.0.0.1','10.4.0.1','100.100.100.200','169.254.169.254','172.17.0.1','192.168.0.1','198.18.0.1','224.0.0.1','::1','::ffff:127.0.0.1'])assert.equal(publicAddress(ip),false,ip);
 assert.equal(publicAddress('8.8.8.8'),true);assert.equal(checkedURL('https://example.org/a.pdf#x').hash,'');
});
test('platform identity cannot be spoofed by host suffix',()=>{
 assert.equal(providerOf('https://www.scribd.com/document/1'),'Scribd');
 assert.equal(providerOf('https://scribd.com.evil.org/document/1'),'PDF');
 assert.equal(providerOf('https://issuu.com/a/docs/b'),'Issuu');
 assert.equal(providerOf('https://www.slideshare.net/slideshow/a'),'SlideShare');
 assert.equal(providerOf('https://www.academia.edu/1'),'Academia');
});
test('extracts bounded literal PDF anchors; ignores scripts and bad URLs',()=>{
 const html='<script>let hidden="https://example.org/private.pdf";</script><a href="/a.pdf?x=1&amp;y=2">a</a><a href="http://localhost/b.pdf">b</a><a href="javascript:evil()">c</a><a href="/a.pdf?x=1&amp;y=2">a</a>';
 assert.deepEqual(publicPDFLinks(html,'https://www.scribd.com/doc/1'),['https://www.scribd.com/a.pdf?x=1&y=2']);
});
test('direct PDF resolves to original bytes',async()=>{
 const r=await resolveDocument('https://example.org/test.pdf',async()=>remote(pdf));assert.deepEqual(r.body,pdf);
});
test('all four platforms resolve public anchors using controlled fixtures',async()=>{
 for(const host of ['www.scribd.com','issuu.com','www.slideshare.net','www.academia.edu']){
  const source=`https://${host}/document/1`;const calls=[];
  const r=await resolveDocument(source,async url=>{calls.push(url);return url.endsWith('/a.pdf')?remote(pdf):remote(Buffer.from('<a href="/a.pdf">PDF</a>'),{'content-type':'text/html'},source);});
  assert.deepEqual(r.body,pdf);assert.equal(calls.length,2);
 }
});
test('login HTML and fake PDF return unavailable, never invented downloads',async()=>{
 for(const url of ['https://www.scribd.com/document/1','https://example.org/fake.pdf']){
  const r=await resolveDocument(url,async()=>remote(Buffer.from('<h1>Sign in</h1>'),{'content-type':'text/html'},url));assert.equal(r.available,false);assert.equal(r.body,undefined);
 }
});
test('network downloader blocks forbidden schemes before requesting',async()=>{
 const original=console.error;console.error=()=>{};
 try{await assert.rejects(fetchPublic('http://127.0.0.1/secret'));}finally{console.error=original;}
});
test('API demo, real resolver seam, isolation, expiry, errors and assets',async t=>{
 let time=1000,calls=0;
 const app=createApp({now:()=>time,ttl:1000,resolver:async url=>{calls++;if(url==='fail')throw new Error('PRIVATE_DATABASE_DETAIL');return {body:pdf,provider:'PDF'};}});
 app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>app.close());
 const base=`http://127.0.0.1:${app.address().port}`;
 const home=await fetch(base);assert.equal(home.status,200);assert.match(await home.text(),/lang="ar" dir="rtl"/);assert.ok(home.headers.get('content-security-policy'));
 const cookie=home.headers.get('set-cookie').split(';')[0];
 const post=(path,body,extra={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie,...extra},body:JSON.stringify(body)});
 assert.equal((await post('/api/resolve',{url:'https://example.org/a.pdf',authorized:false})).status,400);assert.equal(calls,0);
 assert.equal((await post('/api/demo',{}, {Origin:'https://evil.org'})).status,403);
 const demo=await (await post('/api/demo',{})).json();assert.equal(demo.status,'ready');
 const file=await fetch(base+demo.download,{headers:{Cookie:cookie}});assert.equal(file.headers.get('content-type'),'application/pdf');assert.deepEqual(Buffer.from(await file.arrayBuffer()),pdf);
 assert.equal((await fetch(base+demo.download)).status,404);
 time+=1001;assert.equal((await fetch(base+demo.download,{headers:{Cookie:cookie}})).status,404);
 const ready=await (await post('/api/resolve',{url:'https://example.org/a.pdf',authorized:true})).json();assert.equal(ready.status,'ready');assert.equal(calls,1);
 const original=console.error;console.error=()=>{};
 try{const fail=await post('/api/resolve',{url:'fail',authorized:true});assert.equal(fail.status,400);assert.doesNotMatch(await fail.text(),/PRIVATE_DATABASE_DETAIL/);}finally{console.error=original;}
 assert.equal((await post('/api/demo',{padding:'x'.repeat(5000)})).status,413);
 for(const asset of ['/style.css','/app.js'])assert.equal((await fetch(base+asset)).status,200);
 for(let i=0;i<6;i++)await post('/api/demo',{});
 assert.equal((await post('/api/demo',{})).status,429);
});

test('transport pins DNS, rejects mixed DNS and redirect SSRF, enforces size',async()=>{
 const https=(await import('node:https')).default;
 const dns=(await import('node:dns/promises')).default;
 const {PassThrough}=await import('node:stream');
 const {EventEmitter}=await import('node:events');
 const oldGet=https.get,oldLookup=dns.lookup,oldLog=console.error;
 let calls=0,mode='pdf';console.error=()=>{};
 dns.lookup=async()=>[{address:'8.8.8.8',family:4}];
 https.get=(url,options,callback)=>{
  calls++;assert.equal(options.agent,false);assert.equal(url.hostname,'example.org');
  options.lookup('example.org',{all:true},(error,addresses)=>{assert.equal(error,null);assert.deepEqual(addresses,[{address:'8.8.8.8',family:4}]);});
  const req=new EventEmitter();req.setTimeout=()=>{};req.destroy=error=>{req.emit('error',error);};
  process.nextTick(()=>{const res=new PassThrough();res.statusCode=mode==='redirect'?302:200;res.headers=mode==='redirect'?{location:'https://127.0.0.1/secret'}:{'content-type':'application/pdf'};callback(res);if(mode!=='redirect')res.end(pdf);});
  return req;
 };
 try {
  assert.deepEqual((await fetchPublic('https://example.org/a.pdf')).body,pdf);
  mode='redirect';calls=0;await assert.rejects(fetchPublic('https://example.org/a.pdf'));assert.equal(calls,1);
  mode='pdf';await assert.rejects(fetchPublic('https://example.org/a.pdf',{limit:5}));
  dns.lookup=async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}];calls=0;
  await assert.rejects(fetchPublic('https://example.org/a.pdf'));assert.equal(calls,0);
 } finally {https.get=oldGet;dns.lookup=oldLookup;console.error=oldLog;}
});
