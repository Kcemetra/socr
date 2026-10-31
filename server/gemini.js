/* Only the Google API request uses an outbound HTTP/SOCKS proxy. Static assets never do. */
import https from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

function json(object,status=200){return new Response(JSON.stringify(object),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});}
function upstreamRequest(url,method,body){
 return new Promise((resolve,reject)=>{
  const proxy=process.env.GEMINI_PROXY_URL?.trim()||'';
  let agent;
  if(proxy){
   if(/^socks(4|4a|5|5h)?:\/\//i.test(proxy))agent=new SocksProxyAgent(proxy);
   else if(/^https?:\/\//i.test(proxy))agent=new HttpsProxyAgent(proxy);
   else throw Error('GEMINI_PROXY_URL: ожидается http(s):// или socks5(h)://');
  }
  const req=https.request(url,{method,agent,headers:{'Content-Type':'application/json','Accept':'application/json',...(body?{'Content-Length':Buffer.byteLength(body)}:{})}},res=>{
   const chunks=[];let len=0;
   res.on('data',chunk=>{chunks.push(chunk);len+=chunk.length;if(len>40*1024*1024)req.destroy(new Error('API response too large'));});
   res.on('end',()=>resolve({status:res.statusCode||502,body:Buffer.concat(chunks).toString('utf8')}));
  });
  req.setTimeout(54000,()=>req.destroy(new Error('Gemini upstream timeout after 54s')));
  req.on('error',reject);
  if(body)req.write(body);
  req.end();
 });
}
export async function handleGeminiRequest(request){
 const target=new URL(request.url);
 const debugKey=request.headers.get('x-goog-api-key')?.trim();
 const key=debugKey||process.env.GEMINI_API_KEY?.trim();
 const check=target.searchParams.has('check');
 if(!key){return check?json({ok:false,source:'none',message:'GEMINI_API_KEY не задан в секретах хостинга'}):json({error:{message:'API ключ не настроен на сервере'}},503);}
 const source=debugKey?'custom':'server';
 let path,method,body=null;
 if(request.method==='GET'&&(check||target.searchParams.has('models'))){path='models';method='GET';}
 else if(request.method==='POST'){
  const model=target.searchParams.get('model')||'';
  if(!/^[a-zA-Z0-9._-]{1,90}$/.test(model))return json({error:{message:'Некорректное имя модели'}},400);
  path='models/'+model+':generateContent';method='POST';
  body=await request.text();
 }else return json({error:{message:'Неподдерживаемый метод'}},405);
 const url=new URL('https://generativelanguage.googleapis.com/v1beta/'+path);
 url.searchParams.set('key',key);
 if(check)url.searchParams.set('pageSize','1');
 try{
  const up=await upstreamRequest(url,method,body);
  if(check){
   const data=(()=>{try{return JSON.parse(up.body);}catch{return {};}})();
   return json({ok:up.status===200,source,message:up.status===200?'Соединение с серверным ключом работает':data.error?.message||'Ответ API: '+up.status},up.status===200?200:200);
  }
  return new Response(up.body,{status:up.status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
 }catch(error){return check?json({ok:false,source,message:'Нет соединения с API: '+error.message}):json({error:{message:'Ошибка доступа к API: '+error.message}},502);}
}
