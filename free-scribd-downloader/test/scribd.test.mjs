import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {renderScribd} from '../scribd.mjs';
import {samplePDF} from '../server.mjs';

test('local renderer propagates missing setup without inventing a PDF',async()=>{
 const result=await renderScribd('https://www.scribd.com/document/845741935/',undefined,async()=>({ok:false,status:'setup_required'}));
 assert.equal(result.status,'setup_required');assert.equal(result.body,undefined);
});
test('local renderer reads a worker-created PDF through its fixed output path',async()=>{
 const result=await renderScribd('https://www.scribd.com/document/845741935/',undefined,async args=>{const path=args[args.indexOf('--output')+1];await writeFile(path,samplePDF());return {ok:true,pages:1};});
 assert.deepEqual(result.body,samplePDF());assert.equal(result.pages,1);
});
test('local renderer refuses non-Scribd sources before dispatch',async()=>{
 const original=console.error;console.error=()=>{};let called=false;
 try{await assert.rejects(renderScribd('https://example.org/a',undefined,async()=>{called=true;}));assert.equal(called,false);}finally{console.error=original;}
});
