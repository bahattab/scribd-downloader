import https from 'node:https';
import dns from 'node:dns/promises';
import {isIP, BlockList} from 'node:net';

const denied = new BlockList();
for (const [base,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) denied.addSubnet(base,bits,'ipv4');
export function publicAddress(ip) {
  // IPv4 only: reject all IPv6, including mapped/transition addresses.
  return isIP(ip) === 4 && !denied.check(ip,'ipv4');
}
export function checkedURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.href.length > 2048 || isIP(url.hostname) || url.hostname.endsWith('.') || url.hostname === 'localhost' || !url.hostname.includes('.')) throw new Error('URL rejected');
  url.hash = '';
  return url;
}
export async function fetchPublic(value, {limit=20*1024*1024, signal}={}) {
  try {
    let url = checkedURL(value);
    for(let hop=0;hop<5;hop++) {
      signal?.throwIfAborted();
      let dnsTimer;
      let records;
      try { records = await Promise.race([dns.lookup(url.hostname,{all:true,family:4}).then(items=>items.map(item=>item.address)),new Promise((_,reject)=>{dnsTimer=setTimeout(()=>reject(new Error('DNS timeout')),5000);})]); } finally { clearTimeout(dnsTimer); }
      if (!records.length || records.some(ip=>!publicAddress(ip))) throw new Error('Address rejected');
      const ip=records[0];
      const response=await new Promise((resolve,reject)=>{
        const req=https.get(url,{agent:false,signal,lookup:(_host,options,cb)=>options.all?cb(null,[{address:ip,family:4}]):cb(null,ip,4),headers:{'User-Agent':'EB-Docs/0.1','Accept':'application/pdf,text/html;q=0.8','Accept-Encoding':'identity'}},res=>{
          const chunks=[];let size=0;
          if ([301,302,303,307,308].includes(res.statusCode)) {res.destroy();resolve({status:res.statusCode,headers:res.headers,body:Buffer.alloc(0)});return;}
          if (res.statusCode!==200) {res.destroy();reject(new Error('Remote request rejected'));return;}
          if(res.headers['content-encoding'] && res.headers['content-encoding']!=='identity'){res.destroy();reject(new Error('Encoding unsupported'));return;}
          res.on('data',chunk=>{size+=chunk.length;if(size>limit){res.destroy(new Error('Size exceeded'));return;}chunks.push(chunk);});
          res.on('error',reject);res.on('aborted',()=>reject(new Error('Remote aborted')));
          res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
        });
        req.setTimeout(15000,()=>req.destroy(new Error('Timeout')));
        req.on('error',reject);
      });
      if(response.status===200) return {...response,url:url.href};
      if(!response.headers.location) throw new Error('No redirect target');
      url=checkedURL(new URL(response.headers.location,url).href);
    }
    throw new Error('Redirect limit');
  } catch(error) { console.error('[fetchPublic]',error);throw error; }
}
export function providerOf(value) {
  const host=checkedURL(value).hostname;
  for(const [name,domain] of [['Scribd','scribd.com'],['Issuu','issuu.com'],['SlideShare','slideshare.net'],['Academia','academia.edu']]) if(host===domain || host.endsWith('.'+domain)) return name;
  return 'PDF';
}
export function publicPDFLinks(html,base) {
  const results=[];
  // Deliberately narrow: only literal PDF anchors, no script execution or hidden APIs.
  for(const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])([^"']+)\1[^>]*>/gi)) {
    try {
      const link=checkedURL(new URL(match[2].replaceAll('&amp;','&'),base).href);
      if(link.pathname.toLowerCase().endsWith('.pdf') && !results.includes(link.href)) results.push(link.href);
    } catch { /* malformed or forbidden anchors are ignored */ }
    if(results.length===5) break;
  }
  return results;
}
export async function resolveDocument(value, transport=fetchPublic, signal) {
  try {
    const url=checkedURL(value); const provider=providerOf(url.href);
    let result=await transport(url.href,{signal});
    if(result.body.subarray(0,5).toString()==='%PDF-') return {body:result.body,source:result.url,provider};
    if(!String(result.headers['content-type']??'').includes('text/html') || provider==='PDF') return {available:false,provider,source:url.href};
    const links=publicPDFLinks(result.body.toString('utf8'),result.url);
    for(const link of links) {
      signal?.throwIfAborted();
      try { result=await transport(link,{signal});if(result.body.subarray(0,5).toString()==='%PDF-')return {body:result.body,source:result.url,provider}; }
      catch(error) {console.error('[candidate]',error);}
    }
    return {available:false,provider,source:url.href};
  } catch(error) {console.error('[resolveDocument]',error);throw error;}
}


