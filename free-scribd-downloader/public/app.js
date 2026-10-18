const form=document.querySelector('#form'),input=document.querySelector('#url'),authorized=document.querySelector('#authorized'),submit=document.querySelector('#submit'),demo=document.querySelector('#demo'),cancelAll=document.querySelector('#cancel-all'),automatic=document.querySelector('#auto-download');
const result=document.querySelector('#result'),title=document.querySelector('#result-title'),message=document.querySelector('#message'),progress=document.querySelector('#progress'),list=document.querySelector('#batch-list'),note=document.querySelector('#download-note');
const rows=new Map();let currentBatch=null,controller=null,busy=false,lastSnapshot=null,triggered=new Set(),scheduled=new Set(),downloads=Promise.resolve();
const validId=id=>typeof id==='string' && /^[a-f0-9]{48}$/.test(id);
const pending=item=>['queued','processing'].includes(item?.status);
const names={queued:'في الانتظار',processing:'جارٍ التجهيز',ready:'جاهز للتنزيل',failed:'تعذَّر التجهيز',unavailable:'لا يوجد تنزيل متاح',cancelled:'أُلغي الطلب',expired:'انتهت الصلاحية',setup_required:'يلزم تشغيل Setup-Windows.cmd',human_required:'يتطلَّب تحقُّقًا بشريًّا',limit_exceeded:'تجاوز حدود المعالجة'};
function remember(){try{if(currentBatch)sessionStorage.setItem('eb-batch',JSON.stringify({id:currentBatch,triggered:[...triggered]}));else sessionStorage.removeItem('eb-batch');}catch{}}
function setBusy(value){busy=value;submit.disabled=value;demo.disabled=value;submit.textContent=value?'جارٍ تنفيذ القائمة…':'بدء التنزيل';cancelAll.hidden=!value;}
async function json(response){let data;try{data=await response.json();}catch{throw new Error('تعذَّر الاتصال بالخادم. أعد المحاولة.');}if(!response.ok)throw new Error(data?.error??'تعذَّرت معالجة الطلب.');return data;}
function rowFor(item,index){
  if(rows.has(item.id))return rows.get(item.id);
  const article=document.createElement('article');article.className='file-row';
  const heading=document.createElement('h3'),source=document.createElement('p'),status=document.createElement('span'),controls=document.createElement('div'),link=document.createElement('a'),cancel=document.createElement('button');
  source.className='file-source';source.dir='ltr';status.className='file-status';controls.className='file-controls';link.className='file-download';link.textContent='تنزيل PDF';cancel.type='button';cancel.textContent='إلغاء';
  cancel.addEventListener('click',async()=>{cancel.disabled=true;try{await json(await fetch('/api/jobs/'+item.id,{method:'DELETE',signal:AbortSignal.timeout(10000)}));}catch(error){message.textContent=error.message;}finally{cancel.disabled=false;}});
  link.addEventListener('click',()=>{triggered.add(item.id);remember();status.textContent='أُرسل التنزيل إلى المتصفِّح';});
  controls.append(link,cancel);article.append(heading,source,status,controls);list.append(article);
  const row={article,heading,source,status,link,cancel,index};rows.set(item.id,row);return row;
}
function queueDownload(item){
  if(!automatic.checked || triggered.has(item.id) || scheduled.has(item.id))return;
  const batch=currentBatch;scheduled.add(item.id);
  downloads=downloads.then(async()=>{
    try{
      if(currentBatch!==batch || !automatic.checked)return;
      const row=rows.get(item.id);if(!row || row.link.hidden)return;
      row.link.click();note.hidden=false;
      await new Promise(resolve=>setTimeout(resolve,750));
    }finally{scheduled.delete(item.id);}
  }).catch(()=>{message.textContent='تعذَّر بدء تنزيل تلقائي؛ استخدم زر الملف يدويًّا.';});
}
function render(snapshot){
  lastSnapshot=snapshot;result.hidden=false;progress.max=snapshot.total||1;progress.value=snapshot.processed??0;
  title.textContent=snapshot.active?'قائمة التنزيل قيد التنفيذ':'انتهت معالجة القائمة';
  const ready=snapshot.items.filter(item=>item.status==='ready').length;
  message.textContent=`انتهت معالجة ${snapshot.processed??0} من ${snapshot.total??0} ملف. الملفات الجاهزة: ${ready}.`;
  snapshot.items.forEach((item,index)=>{
    const row=rowFor(item,index);row.heading.textContent=`${index+1}. ${item.filename??'المستند '+(index+1)}`;row.source.textContent=item.source??'';
    row.status.textContent=item.status==='ready' && triggered.has(item.id)?'أُرسل التنزيل إلى المتصفِّح':(names[item.status]??'حالة غير متاحة');row.article.dataset.status=item.status;
    row.cancel.hidden=!pending(item);row.link.hidden=!(item.status==='ready' && /^\/api\/files\/[a-f0-9]{48}$/.test(item.download??''));
    if(!row.link.hidden){row.link.href=item.download;row.link.setAttribute('download',item.filename??'document.pdf');queueDownload(item);}else row.link.removeAttribute('href');
  });
}
async function follow(id){
  controller=new AbortController();const signal=controller.signal;
  try{
    // At most two hours per open-page watch; backend jobs each retain their own timeout.
    for(let attempt=0;attempt<7200;attempt++){
      if(signal.aborted)return;
      const snapshot=await json(await fetch('/api/batches/'+id,{signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])}));render(snapshot);
      if(!snapshot.active){await downloads;setBusy(false);remember();return;}
      await new Promise(resolve=>{const timer=setTimeout(done,1000);function done(){clearTimeout(timer);signal.removeEventListener('abort',done);resolve();}signal.addEventListener('abort',done,{once:true});if(signal.aborted)done();});
    }
    throw new Error('انتهت مهلة متابعة القائمة؛ أعد تحميل الصفحة للمتابعة.');
  }catch(error){if(signal.aborted)return;message.textContent=error?.message??'تعذَّر الاتصال بالخادم. أعد تحميل الصفحة لاستئناف القائمة.';setBusy(false);cancelAll.hidden=false;}
}
async function run(){
  if(busy)return;controller?.abort();setBusy(true);result.hidden=false;title.textContent='جارٍ إنشاء قائمة التنزيل';message.textContent='نتحقَّق من الروابط…';
  try{
    const urls=input.value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
    const batch=await json(await fetch('/api/batches',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({urls,authorized:authorized.checked}),signal:AbortSignal.timeout(10000)}));
    if(!validId(batch?.id))throw new Error('تعذَّر إنشاء القائمة.');
    currentBatch=batch.id;triggered=new Set();scheduled=new Set();downloads=Promise.resolve();rows.clear();list.replaceChildren();note.hidden=true;remember();await follow(currentBatch);
  }catch(error){message.textContent=error?.message??'تعذَّر إنشاء القائمة.';setBusy(false);}
}
cancelAll.addEventListener('click',async()=>{
  if(!validId(currentBatch))return;cancelAll.disabled=true;
  try{const snapshot=await json(await fetch('/api/batches/'+currentBatch,{method:'DELETE',signal:AbortSignal.timeout(10000)}));render(snapshot);controller?.abort();await downloads;setBusy(false);remember();}
  catch(error){message.textContent=error?.message??'تعذَّر الإلغاء.';}
  finally{cancelAll.disabled=false;}
});
automatic.addEventListener('change',()=>{if(lastSnapshot)render(lastSnapshot);});
form.addEventListener('submit',event=>{event.preventDefault();run();});
demo.addEventListener('click',async()=>{
  if(busy)return;demo.disabled=true;
  try{
    const response=await json(await fetch('/api/demo',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)}));
    currentBatch='demo';rows.clear();list.replaceChildren();triggered.clear();render({active:false,total:1,processed:1,items:[{id:'demo',...response}]});
  }catch(error){result.hidden=false;message.textContent=error?.message??'تعذَّر تشغيل المثال.';}
  finally{demo.disabled=false;}
});
try{const saved=JSON.parse(sessionStorage.getItem('eb-batch')??'null');if(validId(saved?.id)){currentBatch=saved.id;triggered=new Set(Array.isArray(saved.triggered)?saved.triggered:[]);setBusy(true);follow(currentBatch);}}catch{}
