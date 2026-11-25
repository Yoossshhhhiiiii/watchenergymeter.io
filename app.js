'use strict';
const el = id => document.getElementById(id);
function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c}
async function decode(file){
  let blob=file;
  async function load(b){const url=URL.createObjectURL(b), img=new Image();try{img.src=url;await img.decode();return img}finally{URL.revokeObjectURL(url)}}
  try{return await load(blob)}catch(e){
    if(!/hei[cf]/i.test(file.name+' '+file.type))throw e;
    blob=await heic2any({blob:file,toType:'image/jpeg',quality:.94});
    return load(Array.isArray(blob)?blob[0]:blob);
  }
}
function findRow(cv,photo){
  const src=cv.imread(photo),gray=new cv.Mat(),circles=new cv.Mat();
  try{
    cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);cv.medianBlur(gray,gray,3);
    const points=[];
    // Isolate thin circular outlines against the light face of the register.
    for(const [lo,hi] of [[10,19],[19,35],[35,60],[60,100]]){
      cv.HoughCircles(gray,circles,cv.HOUGH_GRADIENT,1,lo*1.5,90,20,lo,hi);
      const pixels=gray.data, w=photo.width;
      for(let i=0;i<circles.cols;i++){
        const [x,y,r]=circles.data32F.slice(i*3,i*3+3);
        if(x<r*1.2||y<r*1.2||x+r*1.2>=w||y+r*1.2>=photo.height)continue;
        let hits=0;
        for(let j=0;j<48;j++){
          const angle=j*Math.PI/24,dx=r*Math.cos(angle),dy=r*Math.sin(angle);
          const grayAt=f=>pixels[Math.round(y+dy*f)*w+Math.round(x+dx*f)];
          const line=Math.min(...[.91,.95,.99,1.03,1.07].map(grayAt));
          if(grayAt(1.16)-line>25&&grayAt(.77)-line>10)hits++;
        }
        if(hits>22)points.push({x,y,r,hits});
      }
    }
    let best=null;
    for(const a of points)for(const b of points){
      const dx=b.x-a.x,dy=b.y-a.y;
      if(dx<a.r*1.65||dx>a.r*2.6||Math.abs(dy)>dx*.35||Math.abs(a.r-b.r)>a.r*.22)continue;
      const row=[a,b];let error=Math.abs(a.r-b.r)/a.r;
      for(let i=2;i<5;i++){
        let candidate=null,score=.48;
        for(const p of points){
          const d=Math.hypot(p.x-a.x-i*dx,p.y-a.y-i*dy)/a.r+Math.abs(p.r-a.r)/a.r;
          if(d<score){candidate=p;score=d}
        }
        if(!candidate)break;row.push(candidate);error+=score;
      }
      if(row.length===5)error-=row.reduce((sum,p)=>sum+p.hits/48,0);
      if(row.length===5&&(!best||error<best.error))best={row,error};
    }
    if(!best)throw Error('未找到完整的五個錶盤。請正面拍攝，讓五盤放大且完整入鏡。');
    return best.row;
  }finally{circles.delete();gray.delete();src.delete()}
}
function needle(data,width,p,tilt,i){
  const samples=[];
  for(let deg=0;deg<360;deg++){
    const angle=deg*Math.PI/180,dx=Math.sin(angle),dy=-Math.cos(angle);let total=0;
    for(let k=30;k<=76;k+=2){
      const x=Math.round(p.x+p.r*k/100*dx),y=Math.round(p.y+p.r*k/100*dy);
      const j=4*(y*width+x);total+=(data[j]+data[j+1]+data[j+2])/3;
    }
    samples.push(total/24);
  }
  const sorted=[...samples].sort((a,b)=>a-b),threshold=sorted[1]+(sorted[180]-sorted[1])*.30;
  let longest=0,end=0,run=0;
  for(let d=0;d<720;d++){run=samples[d%360]<threshold?run+1:0;if(run>longest){longest=run;end=d}}
  if(longest<4||longest>80||sorted[180]-sorted[1]<28)throw Error('指針受反光或陰影遮蔽，請換角度再拍。');
  const deg=(end-(longest-1)/2+360)%360;
  return {pos:(((deg-tilt)*(i%2?-1:1)/36)%10+10)%10,deg};
}
function digits(values){
  const out=[];for(let i=4;i>=0;i--){
    const v=values[i],near=Math.round(v);
    let digit=i===4&&Math.abs(near-v)<.16?near:Math.floor(v);
    if(i<4&&Math.abs(near-v)<.28)digit=near-(values[i+1]>=5?1:0);
    out[i]=(10+digit)%10;
  }return out;
}
async function roomNumber(photo,row){
  const left=row[0],right=row[4],span=right.x-left.x;
  const c=canvas(Math.ceil(span*1.5),Math.ceil(span*1.7)),ctx=c.getContext('2d');
  ctx.drawImage(photo,-Math.round(left.x-span*.25),-Math.round(left.y-span*2.08));
  const im=ctx.getImageData(0,0,c.width,c.height),d=im.data;
  let x0=c.width,y0=c.height,x1=0,y1=0;
  for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
    const j=(y*c.width+x)*4,r=d[j],g=d[j+1],b=d[j+2];
    const ink=d[j+3]>0&&b>1.55*r&&b>1.17*g&&g<155;
    d[j]=d[j+1]=d[j+2]=ink?0:255;d[j+3]=255;
    if(ink){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}
  }
  // Select nearby tall ink components of similar height (handwritten digits).
  const seen=new Uint8Array(c.width*c.height),parts=[];
  for(let n=0;n<seen.length;n++){
    if(seen[n]||d[n*4]!==0)continue;
    const stack=[n];seen[n]=1;let l=c.width,t=c.height,r=0,b=0,size=0;
    while(stack.length){
      const u=stack.pop(),x=u%c.width,y=Math.floor(u/c.width);size++;
      l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);
      for(const v of [u-1,u+1,u-c.width,u+c.width]){
        if(v<0||v>=seen.length||seen[v]||d[v*4]!==0||Math.abs(v%c.width-x)>1)continue;
        seen[v]=1;stack.push(v)
      }
    }
    const h=b-t+1;
    if(h>span*.09&&h<span*.8&&r-l<h*1.5&&size>h*1.5)parts.push({l,t,r,b,h,size});
  }
  parts.sort((a,b)=>b.size-a.size);
  let ordered=[];
  if(parts.length){
    const a=parts[0],line=parts.filter(p=>p.h>a.h*.45&&Math.abs((p.b+p.t)-(a.b+a.t))<a.h*.7);
    ordered=line.sort((a,b)=>a.l-b.l);
    x0=Math.min(...line.map(p=>p.l));x1=Math.max(...line.map(p=>p.r));y0=Math.min(...line.map(p=>p.t));y1=Math.max(...line.map(p=>p.b));
  }
  if(x1-x0<12||y1-y0<12)return '';
  ctx.putImageData(im,0,0);
  const crop=canvas(x1-x0+21,y1-y0+21),g=crop.getContext('2d');
  g.fillStyle='white';g.fillRect(0,0,crop.width,crop.height);g.drawImage(c,x0,y0,x1-x0+1,y1-y0+1,10,10,x1-x0+1,y1-y0+1);
  const worker=await Tesseract.createWorker('eng',1,{workerPath:'lib/worker.min.js',corePath:'lib/tesseract-core-lstm.wasm.js',langPath:'lib'});
  try{await worker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789'});
    const {data}=await worker.recognize(crop);const s=data.text.trim();if(!/^\d{2,5}$/.test(s))return '';
    if(s.length!==ordered.length)return s;
    return [...s].map((digit,i)=>{
      if(digit!=='9')return digit;
      const p=ordered[i],w=p.r-p.l+1,h=p.h;
      // A handwritten 2 has an open upper stroke and a long horizontal foot.
      const mask=new Uint8Array((w+2)*(h+2)),stride=w+2;
      let footLeft=w,footRight=0;
      for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
        if(d[((p.t+yy)*c.width+p.l+xx)*4]!==0)continue;
        mask[(yy+1)*stride+xx+1]=1;
        if(yy>h*.8){footLeft=Math.min(footLeft,xx);footRight=Math.max(footRight,xx)}
      }
      const queue=[0];mask[0]=2;
      for(let k=0;k<queue.length;k++)for(const v of [queue[k]-1,queue[k]+1,queue[k]-stride,queue[k]+stride]){
        if(v>=0&&v<mask.length&&!mask[v]&&Math.abs(v%stride-queue[k]%stride)<=1){mask[v]=2;queue.push(v)}
      }
      const hole=mask.reduce((n,v)=>n+(v===0),0);
      return hole<w*h*.05&&footRight-footLeft>w*.5?'2':digit;
    }).join('');
  }finally{await worker.terminate()}
}
let busy=false;
async function analyze(file){
  if(!file||busy)return;busy=true;el('pick').disabled=true;el('result').hidden=el('preview').hidden=true;
  try{
    el('msg').textContent='正在解碼照片…';const img=await decode(file);
    const photo=el('photo'),scale=Math.min(1,1400/Math.max(img.width,img.height));
    photo.width=Math.round(img.width*scale);photo.height=Math.round(img.height*scale);
    const ctx=photo.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,photo.width,photo.height);el('preview').hidden=false;
    el('msg').textContent='正在定位五個錶盤…';await new Promise(r=>setTimeout(r,30));
    const row=findRow(await window.cv,photo),data=ctx.getImageData(0,0,photo.width,photo.height).data;
    const tilt=Math.atan2(row[4].y-row[0].y,row[4].x-row[0].x)*180/Math.PI;
    const angles=row.map((p,i)=>needle(data,photo.width,p,tilt,i)),positions=angles.map(a=>a.pos),reading=digits(positions);
    const r=Math.max(...row.map(p=>p.r))*1.2,detail=el('detail'),x=row[0].x-r,y=Math.min(...row.map(p=>p.y))-r;
    detail.width=row[4].x+r-x;detail.height=Math.max(...row.map(p=>p.y))+r-y;
    detail.getContext('2d').drawImage(img,x/scale,y/scale,detail.width/scale,detail.height/scale,0,0,detail.width,detail.height);
    detail.style.width='min(100%, 660px)';
    el('value').textContent=reading.join('');el('notes').textContent='由左至右為 '+reading.join('、')+'。'+(Math.abs(positions[4]-Math.round(positions[4]))<.2?'最右盤接近刻線，請核對放大圖。':'');
    el('result').hidden=false;el('room').value='';el('room').placeholder='辨識中';el('msg').textContent='正在辨識手寫房號…';
    let room='';try{room=await roomNumber(photo,row)}catch(e){console.warn(e)}
    el('room').value=room;el('room').placeholder='待確認';el('msg').textContent='判讀完成，請對照原圖核對。';
  }catch(e){el('msg').textContent=e instanceof Error&&/[\u3400-\u9fff]/.test(e.message)?e.message:'無法讀取照片，請改用 JPEG 或 PNG 再試。';console.warn(e)}
  finally{busy=false;el('pick').disabled=false;el('file').value=''}
}
el('pick').onclick=()=>el('file').click();el('file').onchange=e=>analyze(e.target.files[0]);
for(const evt of ['dragover','dragleave','drop'])el('drop').addEventListener(evt,e=>{e.preventDefault();el('drop').classList.toggle('over',evt==='dragover');if(evt==='drop')analyze(e.dataTransfer.files[0])});
