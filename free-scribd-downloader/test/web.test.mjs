import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import http from 'node:http';
async function proxyFetch(url,options={}){return new Promise((resolve,reject)=>{const request=http.request(url,{method:options.method??'GET',headers:options.headers},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{const body=Buffer.concat(chunks).toString();resolve({status:response.statusCode,headers:{get:name=>{const value=response.headers[name.toLowerCase()];return Array.isArray(value)?value.join(', '):value;}},json:async()=>JSON.parse(body),text:async()=>body});});});request.on('error',reject);request.end(options.body);});}
import {createApp} from '../server.mjs';
test('public origin configuration requires HTTPS and a gateway secret',()=>{
 for(const publicOrigin of ['http://docs.example.org','https://docs.example.org/path','https://u:p@docs.example.org'])assert.throws(()=>createApp({publicOrigin,gatewayToken:'x'.repeat(40)}));
 assert.throws(()=>createApp({publicOrigin:'https://docs.example.org',gatewayToken:'short'}));
});
test('web mode enforces gateway, host, HTTPS cookie and CSRF',async t=>{
 const publicOrigin='https://docs.example.org',gatewayToken='a'.repeat(48);
 const app=createApp({publicOrigin,gatewayToken});app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>app.close());
 const base=`http://127.0.0.1:${app.address().port}`;
 assert.equal((await proxyFetch(base)).status,403);
 const headers={Host:'docs.example.org','X-EB-Gateway':gatewayToken};
 assert.equal((await proxyFetch(base,{headers:{...headers,Host:'wrong.example.org'}})).status,403);
 const home=await proxyFetch(base,{headers});assert.equal(home.status,200);assert.match(home.headers.get('set-cookie'),/; Secure/);
 const cookie=home.headers.get('set-cookie').split(';')[0];
 const post={...headers,Cookie:cookie,'Content-Type':'application/json'};
 assert.equal((await proxyFetch(base+'/api/batches',{method:'POST',headers:{...post,Origin:'http://docs.example.org'},body:JSON.stringify({urls:['https://example.org/a.pdf'],authorized:true})})).status,403);
 const demo=await proxyFetch(base+'/api/demo',{method:'POST',headers:{...post,Origin:publicOrigin},body:'{}'});assert.equal(demo.status,200);
 const item=await demo.json();const file=await proxyFetch(base+item.download,{headers:{...headers,Cookie:cookie}});assert.equal(file.status,200);assert.match(await file.text(),/^%PDF-/);
});
