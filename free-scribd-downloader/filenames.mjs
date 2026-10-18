// Construct a safe user-facing name independently of the temporary worker path.
export function documentFilename(source,title='') {
  let name=typeof title==='string'?title:'';
  name=name.replace(/(?:\s*[|\u2013-]\s*(?:PDF|Scribd))+\s*$/gi,'').trim();
  if(/^scribd$/i.test(name))name='';
  if(!name){
    try{const parts=new URL(source).pathname.split('/').filter(Boolean);const tail=parts.at(-1)??'';name=/^\d+$/.test(tail)?'Scribd-'+tail:decodeURIComponent(tail).replace(/[-_]+/g,' ');}catch{name='';}
  }
  name=name.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim().replace(/[. ]+$/g,'').replace(/\.pdf$/i,'').trim();
  name=Array.from(name).slice(0,120).join('').replace(/[. ]+$/g,'')||'EB-Document';
  if(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name))name='_'+name;
  return name+'.pdf';
}
export function attachmentHeader(filename) {
  const encoded=encodeURIComponent(filename).replace(/[!'()*]/g,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase());
  return 'attachment; filename="EB-Document.pdf"; filename*=UTF-8\'\''+encoded;
}
