/* Image preparation. Everything runs locally in a Web Worker, one page at a time. */
'use strict';
const clamp=(v,lo,hi)=>v<lo?lo:v>hi?hi:v;
const encoder=new TextEncoder();
function grayPixels(pixels){
 const v=new Uint8Array(pixels.length>>2);
 for(let i=0,j=0;i<pixels.length;i+=4,j++)v[j]=Math.round(pixels[i]*.299+pixels[i+1]*.587+pixels[i+2]*.114);
 return v;
}
// True median over a 5x5 neighbourhood, sliding histogram with 16 coarse buckets.
function median5(src,w,h){
 const dst=new Uint8Array(src.length),bins=new Uint16Array(256),coarse=new Uint16Array(16);
 const change=(v,delta)=>{bins[v]+=delta;coarse[v>>4]+=delta;};
 for(let y=0;y<h;y++){
   bins.fill(0);coarse.fill(0);
   for(let dy=-2;dy<=2;dy++){
     const yy=clamp(y+dy,0,h-1)*w;
     for(let dx=-2;dx<=2;dx++)change(src[yy+clamp(dx,0,w-1)],1);
   }
   for(let x=0;x<w;x++){
     let running=0,block=0;
     for(;block<16;block++){if(running+coarse[block]>=13)break;running+=coarse[block];}
     let median=block*16;
     for(;median<Math.min(256,(block+1)*16);median++){running+=bins[median];if(running>=13)break;}
     dst[y*w+x]=Math.min(255,median);
     if(x<w-1){const lx=clamp(x-2,0,w-1),rx=clamp(x+3,0,w-1);
       for(let dy=-2;dy<=2;dy++){const yy=clamp(y+dy,0,h-1)*w;change(src[yy+lx],-1);change(src[yy+rx],1);}
     }
   }
 }
 return dst;
}
function gaussKernel(size){const sigma=.3*((size-1)*.5-1)+.8;const k=new Float32Array(size);let sum=0;
 for(let i=0;i<size;i++){const d=i-(size-1)/2;k[i]=Math.exp(-d*d/(2*sigma*sigma));sum+=k[i];}
 for(let i=0;i<size;i++)k[i]/=sum;return k;}
// Equivalent type of Gaussian-weighted adaptive threshold as OpenCV; fixed-point rounding can differ slightly.
function gaussianBinary(src,w,h,size=31,C=10){
 const k=gaussKernel(size),rad=size>>1,mid=new Float32Array(src.length),out=new Uint8Array(src.length);
 for(let y=0;y<h;y++){const off=y*w;for(let x=0;x<w;x++){
  let sum=0;for(let t=-rad;t<=rad;t++)sum+=src[off+clamp(x+t,0,w-1)]*k[t+rad];mid[off+x]=sum;
 }}
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  let sum=0;for(let t=-rad;t<=rad;t++)sum+=mid[clamp(y+t,0,h-1)*w+x]*k[t+rad];
  // OpenCV computes threshold and rounds internally; this approximation uses raw float.
  const i=y*w+x;out[i]=src[i]>sum-C?255:0;
 }
 return out;
}
function u32(n){return new Uint8Array([(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]);}
const crcTable=new Uint32Array(256);
for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):(c>>>1);crcTable[n]=c>>>0;}
function crc32(arr){let c=0xffffffff;for(let i=0;i<arr.length;i++)c=crcTable[(c^arr[i])&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function chunk(tag,data){const type=encoder.encode(tag),all=new Uint8Array(8+data.length+4);all.set(u32(data.length));all.set(type,4);all.set(data,8);const checksum=new Uint8Array(4+data.length);checksum.set(type);checksum.set(data,4);all.set(u32(crc32(checksum)),8+data.length);return all;}
async function deflate(data){const stream=new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));return new Uint8Array(await new Response(stream).arrayBuffer());}
async function bitonalPngAndPdf(binary,w,h){
 const pitch=Math.ceil(w/8),raw=new Uint8Array((pitch+1)*h),pdfRaw=new Uint8Array(pitch*h);
 for(let y=0;y<h;y++){let srcY=y*w,dstY=y*pitch;
  for(let x=0;x<w;x++){if(binary[srcY+x]>127){const idx=dstY+(x>>3),bit=1<<(7-(x&7));pdfRaw[idx]|=bit;raw[y*(pitch+1)+1+(x>>3)]|=bit;}}
 }
 const [zpng,zpdf]=await Promise.all([deflate(raw),deflate(pdfRaw)]);
 const ihdr=new Uint8Array(13);ihdr.set(u32(w),0);ihdr.set(u32(h),4);ihdr[8]=1;ihdr[9]=0;
 const png=new Blob([new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zpng),chunk('IEND',new Uint8Array())],{type:'image/png'});
 return {blob:png,pdfStream:new Blob([zpdf],{type:'application/octet-stream'}),pdfColor:'bw'};
}
async function process(file,preset,maxSide){
 const bitmap=await createImageBitmap(file);
 try{
 let {width:w,height:h}=bitmap;
 if(maxSide>0&&Math.max(w,h)>maxSide){const k=maxSide/Math.max(w,h);w=Math.max(1,Math.round(w*k));h=Math.max(1,Math.round(h*k));}
 const canvas=new OffscreenCanvas(w,h),ctx=canvas.getContext('2d',{willReadFrequently:true});
 ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(bitmap,0,0,w,h);
 const id=ctx.getImageData(0,0,w,h);let gray=grayPixels(id.data);
 if(preset==='original'||preset==='binary'){
  if(preset==='original')gray=median5(gray,w,h);
  const binary=gaussianBinary(gray,w,h,31,preset==='original'?10:7);
  return {width:w,height:h,...await bitonalPngAndPdf(binary,w,h)};
 }
 // Gentle profile intentionally preserves gray levels and thin strokes; no extra sharpening or threshold.
 for(let p=0;p<gray.length;p++){
  let v=gray[p];
  if(preset==='gray')v=clamp(Math.round((v-128)*1.07+132),0,255);
  const k=p<<2;id.data[k]=v;id.data[k+1]=v;id.data[k+2]=v;id.data[k+3]=255;
 }
 ctx.putImageData(id,0,0);
 const jpeg=await canvas.convertToBlob({type:'image/jpeg',quality:preset==='gentle'?.92:.88});
 return {width:w,height:h,blob:jpeg,pdfStream:null,pdfColor:'jpeg'};
 }finally{bitmap.close();}
}
async function preparePdf(file){
 if(file.type==='image/jpeg'){
  const bmp=await createImageBitmap(file);const w=bmp.width,h=bmp.height;bmp.close();return {width:w,height:h,blob:file,pdfStream:null,pdfColor:'jpeg'};
 }
 const bmp=await createImageBitmap(file);
 try{const canvas=new OffscreenCanvas(bmp.width,bmp.height),ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,bmp.width,bmp.height);ctx.drawImage(bmp,0,0);
 const blob=await canvas.convertToBlob({type:'image/jpeg',quality:.92});return {width:bmp.width,height:bmp.height,blob,pdfStream:null,pdfColor:'jpeg'};
 }finally{bmp.close();}
}
self.onmessage=async e=>{
 const {id,kind,file,preset,maxSide}=e.data;
 try{const data=kind==='preparePdf'?await preparePdf(file):await process(file,preset,maxSide);self.postMessage({id,ok:true,data});}
 catch(error){self.postMessage({id,ok:false,error:String(error?.message||error)});}
};
