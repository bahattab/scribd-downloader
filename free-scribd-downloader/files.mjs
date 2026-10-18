import {mkdtemp,writeFile,readFile,unlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,basename} from 'node:path';

export class TemporaryFiles {
  constructor(records,{now=Date.now,ttl=600000,limit=400*1024*1024}={}){this.records=records;this.now=now;this.ttl=ttl;this.limit=limit;this.root=null;}
  async put(id,body,metadata){
    try{
      await this.sweep();
      let bytes=0;for(const item of this.records.values())bytes+=item.bytes??item.body?.length??0;
      if(this.records.size>=40 || bytes+body.length>this.limit)throw new Error('Temporary file quota exceeded');
      if(!this.root)this.root=await mkdtemp(join(tmpdir(),'eb-docs-files-'));
      const path=join(this.root,id+'.pdf');await writeFile(path,body,{flag:'wx'});
      this.records.set(id,{...metadata,path,bytes:body.length,expires:this.now()+this.ttl});
    }catch(error){console.error('[files.put]',error);throw error;}
  }
  async read(item){try{return item.body??await readFile(item.path);}catch(error){console.error('[files.read]',error);throw error;}}
  async sweep(){
    try{for(const [id,item] of this.records){if(item.expires>this.now())continue;this.records.delete(id);if(item.path){if(dirname(resolve(item.path))!==resolve(this.root))throw new Error('Invalid file cleanup path');await unlink(item.path).catch(error=>{if(error.code!=='ENOENT')throw error;});}}}
    catch(error){console.error('[files.sweep]',error);throw error;}
  }
  async close(){
    try{if(this.root){if(dirname(resolve(this.root))!==resolve(tmpdir()) || !basename(this.root).startsWith('eb-docs-files-'))throw new Error('Invalid cleanup root');await rm(this.root,{recursive:true,force:true});}}
    catch(error){console.error('[files.close]',error);}
  }
}
