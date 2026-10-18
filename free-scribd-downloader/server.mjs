import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolveDocument,checkedURL,providerOf} from './downloader.mjs';
import {JobQueue} from './jobs.mjs';
import {TemporaryFiles} from './files.mjs';
import {renderScribd} from './scribd.mjs';
import {documentFilename,attachmentHeader} from './filenames.mjs';

const token=()=>randomBytes(24).toString('hex');
export function samplePDF() {
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const stream='BT /F1 22 Tf 60 750 Td (EB Docs - Download verified) Tj ET';
  objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  let text='%PDF-1.4\n';const offsets=[0];
  objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${obj}\nendobj\n`;});
  const xref=Buffer.byteLength(text);text+=`xref\n0 6\n0000000000 65535 f \n`;
  text+=offsets.slice(1).map(x=>String(x).padStart(10,'0')+' 00000 n \n').join('');
  return Buffer.from(text+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
export function createApp({resolver=resolveDocument,now=Date.now,ttl=600000,publicOrigin=null,gatewayToken=null}={}) {
  if(publicOrigin){const u=new URL(publicOrigin);if(u.protocol!=='https:' || u.origin!==publicOrigin || u.username || u.password)throw new Error('Web origin must be an HTTPS origin without a path');if(typeof gatewayToken!=='string' || gatewayToken.length<32)throw new Error('Web gateway token must contain at least 32 characters');}
  const sessions=new Map(),files=new Map(),batches=new Map();let active=0;
  const storage=new TemporaryFiles(files,{now,ttl});
  const getDocument=async(url,signal)=>{
    try{return resolver===resolveDocument && providerOf(url)==='Scribd'?await renderScribd(url,signal):await resolver(url,undefined,signal);}
    catch(error){console.error('[getDocument]',error);throw error;}
  };
  const jobs=new JobQueue(async(payload,signal,owner)=>{
    try {
      const result=payload.demo?{body:samplePDF(),provider:'Demo PDF'}:await getDocument(payload.url,signal);
      signal.throwIfAborted();
      if(!result.body)return {status:result.status??'unavailable',provider:result.provider,message:'No PDF download was produced.'};
      const filename=documentFilename(payload.url,result.title??(payload.demo?'EB Sample':''));
      const id=token();await storage.put(id,result.body,{owner,filename});
      return {status:'ready',filename,provider:result.provider,bytes:result.body.length,download:'/api/files/'+id,expiresIn:Math.round(ttl/1000)};
    } catch(error){console.error('[job.worker]',error);throw error;}
  },{now,ttl,timeout:300000,concurrency:1,perOwner:20,capacity:60});
  const assets=new Map([['/',['index.html','text/html; charset=utf-8']],['/app.js',['app.js','text/javascript; charset=utf-8']],['/style.css',['style.css','text/css; charset=utf-8']]]);
  const app=http.createServer(async(req,res)=>{
    const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    try {
      res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      const allowedHosts=new Set([`127.0.0.1:${req.socket.localPort}`,`localhost:${req.socket.localPort}`]);
      if(publicOrigin){
        const supplied=Buffer.from(String(req.headers['x-eb-gateway']??''));const expected=Buffer.from(gatewayToken);
        if(supplied.length!==expected.length || !timingSafeEqual(supplied,expected))return reply(403,{error:'Gateway authentication required.'});
        allowedHosts.clear();allowedHosts.add(new URL(publicOrigin).host);
      }
      if(!allowedHosts.has(req.headers.host)) return reply(403,{error:'طلب غير مسموح.'});
      const origin=publicOrigin??`http://${req.headers.host}`;
      const url=new URL(req.url,origin);
      for(const [id,s] of sessions) if(s.expires<now()) sessions.delete(id);
      await storage.sweep();
      for(const [id,batch] of batches)if(batch.expires<now())batches.delete(id);
      let sessionId=req.headers.cookie?.match(/(?:^|;\s*)eb_session=([a-f0-9]{48})(?:;|$)/)?.[1];
      let session=sessions.get(sessionId);
      if(!session) {
        if(sessions.size>=200) return reply(503,{error:'الخدمة مشغولة؛ حاول لاحقًا.'});
        sessionId=token();session={expires:now()+3600000,count:0,window:now()};sessions.set(sessionId,session);
        res.setHeader('Set-Cookie',`eb_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600${publicOrigin?'; Secure':''}`);
      }
      session.expires=now()+3600000;
      res.setHeader('Set-Cookie',`eb_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600${publicOrigin?'; Secure':''}`);
      if(req.method==='GET' && assets.has(url.pathname)) {
        const [name,mime]=assets.get(url.pathname);const body=await readFile(new URL('./public/'+name,import.meta.url));res.writeHead(200,{'Content-Type':mime});return res.end(body);
      }
      if(req.method==='POST' && url.pathname==='/api/batches') {
        if(req.headers.origin!==origin || !String(req.headers['content-type']??'').startsWith('application/json'))return reply(403,{error:'طلب غير مسموح.'});
        if(now()-session.window>60000){session.count=0;session.window=now();}
        if(++session.count>10)return reply(429,{error:'انتظر قليلًا ثم أعد المحاولة.'});
        let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>50000)return reply(413,{error:'حجم الروابط أكبر من الحد المسموح.'});}
        let input;try{input=JSON.parse(raw);}catch{return reply(400,{error:'بيانات الطلب غير صالحة.'});}
        if(input?.authorized!==true || !Array.isArray(input.urls) || !input.urls.length || input.urls.length>20)return reply(400,{error:'أدخل من رابط واحد إلى 20 رابطًا، وأكِّد صلاحية استخدامها.'});
        const unique=[];const seen=new Set();
        for(let index=0;index<input.urls.length;index++){
          let source;try{if(typeof input.urls[index]!=='string')throw new Error('Invalid type');source=checkedURL(input.urls[index].trim()).href;}
          catch{return reply(400,{error:`الرابط رقم ${index+1} غير صالح. استخدم رابط HTTPS كاملًا.`});}
          if(!seen.has(source)){seen.add(source);unique.push(source);}
        }
        if(batches.size>=50)return reply(429,{error:'قائمة الطلبات ممتلئة؛ حاول لاحقًا.'});
        let created;try{created=jobs.submitMany(sessionId,unique.map(source=>({url:source})));}
        catch{return reply(429,{error:'تجاوزت سعة قائمة الانتظار. انتظر اكتمال الطلبات الحالية.'});}
        const id=token();batches.set(id,{owner:sessionId,expires:now()+3600000,items:created.map((job,index)=>({id:job.id,source:unique[index]}))});
        return reply(202,{id,accepted:created.length,duplicates:input.urls.length-created.length});
      }
      if(url.pathname.startsWith('/api/batches/') && ['GET','DELETE'].includes(req.method)) {
        const batch=batches.get(url.pathname.slice(13));
        if(!batch || batch.owner!==sessionId)return reply(404,{error:'انتهت صلاحية الطلب أو لم يُعثَر عليه.'});
        if(req.method==='DELETE'){
          if(req.headers.origin!==origin)return reply(403,{error:'طلب غير مسموح.'});
          for(const item of batch.items)jobs.cancel(item.id,sessionId);
        }
        const items=batch.items.map(item=>({...item,...(jobs.view(item.id,sessionId)??{status:'expired'})}));
        const processing=items.some(item=>['queued','processing'].includes(item.status));
        if(processing){
          jobs.retain(batch.items.map(item=>item.id),sessionId);
          for(const item of items){const file=files.get(item.download?.split('/').at(-1));if(file?.owner===sessionId)file.expires=now()+ttl;}
        }
        batch.expires=now()+3600000;
        return reply(200,{id:url.pathname.slice(13),items,active:processing,total:items.length,processed:items.filter(item=>!['queued','processing'].includes(item.status)).length});
      }
      if(req.method==='GET' && url.pathname.startsWith('/api/jobs/')) {
        const job=jobs.view(url.pathname.slice(10),sessionId);
        return job?reply(200,job):reply(404,{error:'Job not found or expired.'});
      }
      if(req.method==='DELETE' && url.pathname.startsWith('/api/jobs/')) {
        if(req.headers.origin!==origin)return reply(403,{error:'Request rejected.'});
        const job=jobs.cancel(url.pathname.slice(10),sessionId);
        return job?reply(200,job):reply(404,{error:'Job not found or expired.'});
      }
      if(req.method==='POST' && url.pathname==='/api/jobs') {
        if(req.headers.origin!==origin || !String(req.headers['content-type']??'').startsWith('application/json'))return reply(403,{error:'Request rejected.'});
        if(now()-session.window>60000){session.count=0;session.window=now();}
        if(++session.count>10)return reply(429,{error:'Too many requests. Try again shortly.'});
        let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)return reply(413,{error:'Request too large.'});}
        let input;try{input=JSON.parse(raw);}catch{return reply(400,{error:'Invalid request.'});}
        if(input?.demo!==true){
          if(typeof input?.url!=='string' || input.authorized!==true)return reply(400,{error:'URL and authorization are required.'});
          checkedURL(input.url);
        }
        try{return reply(202,jobs.submit(sessionId,{url:input.url,demo:input.demo===true}));}
        catch{return reply(429,{error:'Queue is full. Try again shortly.'});}
      }
      if(req.method==='GET' && url.pathname==='/api/health') return reply(200,{status:'ok'});
      if(req.method==='GET' && url.pathname.startsWith('/api/files/')) {
        const item=files.get(url.pathname.slice(11));
        if(!item || item.owner!==sessionId) return reply(404,{error:'انتهت صلاحية الملف؛ أعد فحص الرابط.'});
        const body=await storage.read(item);res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':attachmentHeader(item.filename??'EB-Document.pdf'),'Content-Length':body.length});return res.end(body);
      }
      if(req.method==='POST' && ['/api/resolve','/api/demo'].includes(url.pathname)) {
        if(req.headers.origin!==origin || !String(req.headers['content-type']??'').startsWith('application/json')) return reply(403,{error:'طلب غير مسموح.'});
        if(now()-session.window>60000){session.count=0;session.window=now();}
        if(++session.count>10 || active>=2) return reply(429,{error:'انتظر قليلًا ثم أعد المحاولة.'});
        let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096) return reply(413,{error:'الطلب أكبر من الحد المسموح.'});}
        let input;try{input=JSON.parse(raw);}catch{return reply(400,{error:'بيانات الطلب غير صالحة.'});}
        if(url.pathname==='/api/resolve' && (typeof input.url!=='string' || input.url.length>2048 || input.authorized!==true)) return reply(400,{error:'أدخل رابطًا وأكِّد صلاحية استخدام المستند.'});
        active++;
        try {
          const result=url.pathname==='/api/demo'?{body:samplePDF(),provider:'ملف تجريبي'}:await getDocument(input.url,AbortSignal.timeout(300000));
          if(!result.body) return reply(200,{status:'unavailable',provider:result.provider,message:'لم يُعثَر على ملف PDF متاح للتنزيل. افتح صفحة المصدر للتحقُّق من خيارات التنزيل.'});
          let total=0;for(const f of files.values()) total+=f.bytes??f.body?.length??0;
          if(files.size>=20 || total+result.body.length>60*1024*1024) return reply(503,{error:'مساحة التنزيل المؤقَّتة ممتلئة؛ حاول لاحقًا.'});
          const filename=documentFilename(input.url,result.title??(url.pathname==='/api/demo'?'EB Sample':''));
          const id=token();files.set(id,{body:result.body,owner:sessionId,filename,expires:now()+ttl});
          return reply(200,{status:'ready',filename,provider:result.provider,bytes:result.body.length,download:'/api/files/'+id,expiresIn:Math.round(ttl/1000)});
        } finally {active--;}
      }
      return reply(404,{error:'الصفحة غير موجودة.'});
    } catch(error) {console.error('[request]',error);if(!res.headersSent)reply(400,{error:'تعذَّرت معالجة الرابط. تحقَّق منه أو حاول لاحقًا.'});else res.end();}
  });
  app.on('close',()=>{jobs.close();storage.close();});
  return app;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const port=Number(process.env.PORT||3080);const app=createApp();
  app.requestTimeout=60000;app.headersTimeout=10000;
  app.on('error',error=>{console.error('[startup]',error);process.exitCode=1;});
  app.listen(port,'127.0.0.1',()=>console.log(`EB Docs: http://127.0.0.1:${app.address().port}`));
}
