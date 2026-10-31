/* Local-only photo processing and memory-conscious PDF creation. No uploads. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
let items=[],queue=0,worker=null,reqId=0;const pending=new Map();let busy=false;
const enc=new TextEncoder();
function ensureWorker(){if(worker)return worker;worker=new Worker('/image-worker.js');worker.onmessage=e=>{
  const item=pending.get(e.data.id);if(!item)return;pending.delete(e.data.id);
  if(e.data.ok)item.resolve(e.data.data);else item.reject(new Error(e.data.error));
};worker.onerror=e=>{for(const p of pending.values())p.reject(Error(e.message||'Ошибка Photo Worker'));pending.clear();};return worker;}
function workerRun(payload){return new Promise((resolve,reject)=>{const id=++reqId;pending.set(id,{resolve,reject});ensureWorker().postMessage({id,...payload});});}
function message(text){$('labProgressText').textContent=text;}
function bytes(n){return n>=1048576?(n/1048576).toFixed(2)+' МБ':(n/1024).toFixed(0)+' КБ';}
function extName(name,blob){return name.replace(/\.[^.]+$/,'')+'_processed.'+(blob.type==='image/png'?'png':'jpg');}
function fileSort(){const mode=$('labSort').value;items.sort((a,b)=>mode==='time'?(a.file.lastModified-b.file.lastModified):a.file.name.localeCompare(b.file.name,'ru',{numeric:true}));}
function clearUrls(){for(const p of items)if(p.preview)URL.revokeObjectURL(p.preview);}
function setBusy(value){busy=value;for(const id of ['labProcessBtn','labPdfBtn','labZipBtn','labToOcrBtn','labClearBtn'])$(id).disabled=value;}
function render(){fileSort();const box=$('labGrid');box.replaceChildren();
 for(const item of items){const card=document.createElement('div');card.className='lab-tile';
  if(!item.preview)item.preview=URL.createObjectURL(item.processed?.blob||item.file);
  const img=document.createElement('img');img.loading='lazy';img.src=item.preview;img.alt='Фото';
  const info=document.createElement('div');info.className='caption';info.textContent=item.file.name+' • '+bytes(item.file.size)+(item.processed?' → '+bytes(item.processed.blob.size):'');card.append(img,info);box.append(card);
 }
}
function addFiles(files){if(busy)return;for(const f of files){if(!f.type.startsWith('image/'))continue;items.push({file:f,processed:null,preview:null});}render();message('Загружено '+items.length+' фото — '+bytes(items.reduce((s,p)=>s+p.file.size,0)));}
$('labDropzone').addEventListener('click',()=>$('labInput').click());
$('labDropzone').addEventListener('dragover',e=>{e.preventDefault();$('labDropzone').classList.add('dragover');});
$('labDropzone').addEventListener('dragleave',()=>$('labDropzone').classList.remove('dragover'));
$('labDropzone').addEventListener('drop',e=>{e.preventDefault();$('labDropzone').classList.remove('dragover');addFiles(Array.from(e.dataTransfer.files));});
$('labInput').addEventListener('change',e=>{addFiles(Array.from(e.target.files));e.target.value='';});
$('labSort').addEventListener('change',render);
$('labClearBtn').addEventListener('click',()=>{if(busy)return;clearUrls();items=[];$('labProgress').value=0;render();message('Список очищен');});
$('labProcessBtn').addEventListener('click',async()=>{
 if(!items.length)return alert('Выберите фотографии');setBusy(true);$('labProgress').value=0;
 let done=0;try{
  fileSort();for(let i=0;i<items.length;i++){
   const item=items[i];message('Обработка '+(i+1)+' / '+items.length+': '+item.file.name);
   // The original photo is retained as File; worker only decodes one photo at a time.
   item.processed=await workerRun({kind:'process',file:item.file,preset:$('labPreset').value,maxSide:Number($('labMaxSide').value)});
   if(item.preview){URL.revokeObjectURL(item.preview);item.preview=null;}
   done++;$('labProgress').value=Math.round(100*done/items.length);
   if(i%4===0){render();await new Promise(r=>requestAnimationFrame(r));}
  }
  render();message('Готово: '+items.length+' шт. • '+bytes(items.reduce((s,p)=>s+p.file.size,0))+' → '+bytes(items.reduce((s,p)=>s+(p.processed?.blob.size||0),0)));
 }catch(e){message('Ошибка: '+e.message);alert('Обработка прервана: '+e.message);}finally{setBusy(false);}
});
function pdfFromObjects(pages){
 // PDF streams are Blob parts, not base64 or a giant eagerly allocated PDF buffer.
 const chunks=[];let offset=0;const starts=[];const append=p=>{if(typeof p==='string')p=enc.encode(p);chunks.push(p);offset+=p.size??p.length;};
 const begin=id=>{starts[id]=offset;append(`${id} 0 obj\n`);};const end=()=>append('endobj\n');
 append('%PDF-1.4\n%StroyZhurnal\n');const total=2+pages.length*3;
 begin(1);append('<< /Type /Catalog /Pages 2 0 R >>\n');end();
 begin(2);append(`<< /Type /Pages /Kids [${pages.map((_,i)=>3+i*3+' 0 R').join(' ')}] /Count ${pages.length} >>\n`);end();
 pages.forEach((p,i)=>{
  const pg=3+i*3,im=pg+1,co=pg+2;const ratio=p.width/p.height,portrait=ratio<=1,pgW=portrait?595.28:841.89,pgH=portrait?841.89:595.28;
  const k=Math.min((pgW-28)/p.width,(pgH-28)/p.height);const w=(p.width*k).toFixed(3),h=(p.height*k).toFixed(3),x=((pgW-p.width*k)/2).toFixed(3),y=((pgH-p.height*k)/2).toFixed(3);
  const cmd=`q\n${w} 0 0 ${h} ${x} ${y} cm\n/Im0 Do\nQ\n`,cmdBytes=enc.encode(cmd);
  begin(pg);append(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pgW} ${pgH}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${co} 0 R >>\n`);end();
  const data=p.pdfColor==='bw'?p.pdfStream:p.blob,filter=p.pdfColor==='bw'?'/FlateDecode':'/DCTDecode';
  begin(im);append(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace ${p.pdfColor==='bw'?'/DeviceGray':'/DeviceRGB'} /BitsPerComponent ${p.pdfColor==='bw'?1:8} /Filter ${filter} /Length ${data.size} >>\nstream\n`);append(data);append('\nendstream\n');end();
  begin(co);append(`<< /Length ${cmdBytes.length} >>\nstream\n`);append(cmdBytes);append('endstream\n');end();
 });
 const xref=offset;append(`xref\n0 ${total+1}\n0000000000 65535 f \n`);
 for(let i=1;i<=total;i++)append(String(starts[i]).padStart(10,'0')+' 00000 n \n');
 append(`trailer\n<< /Size ${total+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
 return new Blob(chunks,{type:'application/pdf'});
}
$('labPdfBtn').addEventListener('click',async()=>{
 if(!items.length)return alert('Выберите фотографии');setBusy(true);$('labProgress').value=0;const pages=[];
 try{
  fileSort();for(let i=0;i<items.length;i++){
   message('Подготовка PDF '+(i+1)+' / '+items.length);const it=items[i];
   let p=it.processed;
   if(!p)p=await workerRun({kind:'preparePdf',file:it.file});
   // JPEGs are directly embedded; binary scans use 1-bit Flate streams from worker.
   if(p.pdfColor!=='bw'&&p.blob.type!=='image/jpeg')p=await workerRun({kind:'preparePdf',file:p.blob});
   pages.push(p);$('labProgress').value=Math.round(100*(i+1)/items.length);
   if(i%5===0)await new Promise(r=>requestAnimationFrame(r));
  }
  const blob=pdfFromObjects(pages);saveFile(blob,'StroyZhurnal_'+new Date().toISOString().slice(0,10)+'.pdf');message('PDF готов: '+items.length+' страниц • '+bytes(blob.size));
 }catch(e){message('Ошибка PDF: '+e.message);alert('Не удалось собрать PDF: '+e.message);}finally{setBusy(false);}
});
function saveFile(blob,name){const href=URL.createObjectURL(blob),a=document.createElement('a');a.download=name;a.href=href;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),30000);}
$('labZipBtn').addEventListener('click',async()=>{
 if(!items.length)return alert('Выберите фотографии');if(items.some(p=>!p.processed))return alert('Сначала обработайте фото, чтобы избежать создания огромного ZIP из оригиналов');
 setBusy(true);try{const zip=new JSZip();fileSort();
 for(const item of items)zip.file(item.file.name.replace(/\.[^.]+$/,'')+(item.processed.blob.type==='image/png'?'.png':'.jpg'),item.processed.blob);
 const out=await zip.generateAsync({type:'blob',compression:'STORE',streamFiles:true},m=>{$('labProgress').value=m.percent;message('Архивация '+Math.round(m.percent)+'%');});
 saveFile(out,'StroyZhurnal_processed.zip');message('ZIP готов: '+bytes(out.size));
 }catch(e){message('Ошибка ZIP: '+e.message);}finally{setBusy(false);}
});
$('labToOcrBtn').addEventListener('click',async()=>{
 if(!items.length)return alert('Выберите фотографии');if(busy)return;
 const list=items.map(it=>{const blob=it.processed?.blob||it.file;return new File([blob],it.processed?it.file.name.replace(/\.[^.]+$/,'')+'_processed.'+(blob.type==='image/png'?'png':'jpg'):it.file.name,{type:blob.type,lastModified:it.file.lastModified});});
 await window.clientAddPhotos(list);message('Передано в журнал: '+list.length+' фото');
});
})();
