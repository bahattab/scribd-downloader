import {randomBytes} from 'node:crypto';

const terminal=new Set(['ready','unavailable','failed','cancelled','setup_required','human_required','limit_exceeded']);
export class JobQueue {
  constructor(work,{concurrency=2,capacity=40,perOwner=4,ttl=600000,timeout=45000,now=Date.now}={}) {
    this.work=work;this.concurrency=concurrency;this.capacity=capacity;this.perOwner=perOwner;
    this.ttl=ttl;this.timeout=timeout;this.now=now;this.jobs=new Map();this.active=0;this.stopped=false;
  }
  sweep() {
    for(const [id,job] of this.jobs) if(terminal.has(job.status) && job.expires<=this.now())this.jobs.delete(id);
  }
  submit(owner,payload) {return this.submitMany(owner,[payload])[0];}
  submitMany(owner,payloads) {
    try {
      this.sweep();
      const owned=[...this.jobs.values()].filter(job=>job.owner===owner && !terminal.has(job.status)).length;
      if(!Array.isArray(payloads) || !payloads.length || this.stopped || this.jobs.size+payloads.length>this.capacity || owned+payloads.length>this.perOwner)throw new Error('Queue capacity');
      const created=payloads.map(payload=>{
        const id=randomBytes(24).toString('hex');
        this.jobs.set(id,{id,owner,payload,status:'queued',created:this.now(),expires:this.now()+this.ttl,controller:new AbortController()});
        return this.view(id,owner);
      });
      setImmediate(()=>this.pump());return created;
    }catch(error){console.error('[queue.submit]',error);throw error;}
  }
  retain(ids,owner) {
    for(const id of ids){const job=this.jobs.get(id);if(job?.owner===owner && terminal.has(job.status))job.expires=this.now()+this.ttl;}
  }
  view(id,owner) {
    this.sweep();const job=this.jobs.get(id);if(!job || job.owner!==owner)return null;
    const waiting=[...this.jobs.values()].filter(item=>item.status==='queued');
    return {id:job.id,status:job.status,createdAt:job.created,position:job.status==='queued'?waiting.indexOf(job)+1:0,...job.result};
  }
  cancel(id,owner) {
    try {
      const job=this.jobs.get(id);if(!job || job.owner!==owner)return null;
      if(!terminal.has(job.status)){job.status='cancelled';job.expires=this.now()+this.ttl;job.controller.abort();}
      return this.view(id,owner);
    } catch(error) {console.error('[queue.cancel]',error);throw error;}
  }
  pump() {
    if(this.stopped)return;
    for(const job of this.jobs.values()) {
      if(this.active>=this.concurrency)break;
      if(job.status!=='queued')continue;
      this.active++;job.status='processing';
      this.execute(job);
    }
  }
  async execute(job) {
    const signal=AbortSignal.any([job.controller.signal,AbortSignal.timeout(this.timeout)]);
    let onAbort;
    try {
      const interrupted=new Promise((_,reject)=>{onAbort=()=>reject(new Error('Job interrupted'));signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();});
      const result=await Promise.race([Promise.resolve().then(()=>this.work(job.payload,signal,job.owner)),interrupted]);
      if(job.status==='processing') {job.result=result;job.status=result.status;}
    } catch(error) {
      console.error('[queue.execute]',error);
      if(job.status==='processing'){job.status='failed';job.result={message:'تعذَّر تجهيز الملف. تحقَّق من الرابط ثم أعد المحاولة.'};}
    } finally {
      signal.removeEventListener('abort',onAbort);job.expires=this.now()+this.ttl;delete job.payload;this.active--;this.pump();
    }
  }
  close() {this.stopped=true;for(const job of this.jobs.values())job.controller.abort();}
}
